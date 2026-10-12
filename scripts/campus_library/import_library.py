"""Import a reviewed campus document library through authenticated admin APIs."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import time

import httpx

from catalog import DATE, POLICIES, SERVICES


class Admin:
    def __init__(self, url, username, password):
        self.client = httpx.Client(base_url=url.rstrip('/'), trust_env=False, timeout=120)
        self.csrf = self.data(self.client.get('/api/auth/csrf'))
        self.data(self.client.post('/api/auth/login', headers=self.headers,
                                 json=dict(username=username, password=password)))
        self.csrf = self.data(self.client.get('/api/auth/csrf'))
        user = self.data(self.client.get('/api/auth/me'))
        if user['role'] != 'ADMIN':
            raise RuntimeError('An administrator account is required')

    @property
    def headers(self):
        return {self.csrf['headerName']: self.csrf['token']}

    @staticmethod
    def data(response):
        response.raise_for_status()
        body = response.json()
        if 'data' not in body:
            raise RuntimeError(f'Unexpected response: {response.status_code}')
        return body['data']

    def get(self, route, **kwargs):
        return self.data(self.client.get(route, **kwargs))

    def write(self, method, route, **kwargs):
        return self.data(self.client.request(method, route, headers=self.headers, **kwargs))

    def upload(self, route, path):
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        with path.open('rb') as stream:
            return self.write('POST', route, files={'file': (path.name, stream, mime)})


def read_credentials(args):
    password = os.environ.get('CAMPUS_LIBRARY_ADMIN_PASSWORD')
    if args.credential_file:
        content = args.credential_file.read_text(encoding='utf-8')
        match = re.search(r'^' + re.escape(args.username) + r'\s*:\s*(.+)$', content, re.M)
        if not match:
            raise ValueError('Administrator credential not found in the selected local file')
        password = match.group(1).strip()
    if not password:
        raise ValueError('Set CAMPUS_LIBRARY_ADMIN_PASSWORD or provide --credential-file')
    return password


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--url', default='http://127.0.0.1:8080')
    p.add_argument('--username', default='admin')
    p.add_argument('--credential-file', type=Path)
    p.add_argument('--backup', type=Path, required=True)
    args = p.parse_args()
    root = args.output.resolve()
    manifest = json.loads((root / '资料清单.json').read_text(encoding='utf-8'))
    for record in manifest['documents']:
        path = root / record['pdf']
        if not record.get('pdf_sha256') or hashlib.sha256(path.read_bytes()).hexdigest() != record['pdf_sha256']:
            raise RuntimeError('PDF rendering and integrity check must finish before import')
    admin = Admin(args.url, args.username, read_credentials(args))
    # Initialize the embedding provider and vector store on one request before
    # concurrent uploads reach the lazy composition root.
    admin.client.timeout = httpx.Timeout(180)
    admin.write('POST', '/api/knowledge/search', json={'query': '校园事务办理', 'topK': 1})
    existing = {s['code']: s for s in admin.get('/api/admin/services')}
    args.backup.mkdir(parents=True, exist_ok=True)
    original = [admin.get(f"/api/admin/services/{existing[s['code']]['id']}")
                for s in SERVICES if s['code'] in existing]
    snapshot = args.backup / 'existing-services.json'
    if not snapshot.exists():
        snapshot.write_text(json.dumps(original, ensure_ascii=False, indent=2), encoding='utf-8')
        for detail in original:
            for material in detail['service']['materials']:
                attachment = material.get('attachment')
                if attachment:
                    response = admin.client.get(attachment.get('downloadUrl') or f"/api/admin/files/{attachment['id']}/download")
                    response.raise_for_status()
                    (args.backup / (attachment['id'] + '-' + Path(attachment['filename']).name)).write_bytes(response.content)

    receipt_path = root / '知识库导入记录.json'
    receipt = dict(updated_at=DATE, documents=[], services=[])

    def persist():
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')

    def ingest(record):
        result = admin.upload('/api/admin/documents', root / record['pdf'])
        document = result['document']
        document_id = document['id']
        if document['status'] == 'FAILED':
            document = admin.write('POST', f'/api/admin/documents/{document_id}/reprocess')
        expires = time.monotonic() + 900
        while document['status'] == 'PROCESSING':
            if time.monotonic() >= expires:
                raise RuntimeError(f'Document processing timed out: {document_id}')
            time.sleep(1)
            document = admin.get(f'/api/admin/documents/{document_id}/progress')
        if document['status'] != 'SUCCESS' or document['chunkCount'] < 1:
            raise RuntimeError(f'Document indexing failed: {document_id}')
        return dict(kind=record['kind'], key=record['key'], title=record['title'],
                    document_id=document_id, file=record['pdf'], sha256=record['pdf_sha256'],
                    status=document['status'], chunks=document['chunkCount'], duplicate=result['duplicate'])

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(ingest, record): record for record in manifest['documents']}
        for future in as_completed(futures):
            try:
                item = future.result()
            except BaseException:
                for pending in futures:
                    pending.cancel()
                raise
            receipt['documents'].append(item)
            persist()
            print(f"Indexed {len(receipt['documents'])}/{len(manifest['documents'])}: {item['title']} chunks={item['chunks']}", flush=True)

    sources = {(r['kind'], r['key']): r for r in receipt['documents']}
    policy_by_key = {p['key']: p for p in POLICIES}
    categories = dict(academic='学籍管理', teaching='教务服务', funding='奖助与资助', leave='学生事务',
                      dorm='住宿与后勤', card='证件服务', psychology='心理健康', activity='校园活动',
                      library='图书馆服务', employment='就业服务', lab='实验室服务')
    for definition in SERVICES:
        old = existing.get(definition['code'])
        before = admin.get(f"/api/admin/services/{old['id']}") if old else None
        materials = []
        old_materials = {m['name']: m for m in before['service']['materials']} if before else {}
        for m in definition['materials']:
            materials.append(dict(id=old_materials.get(m['name'], {}).get('id'), name=m['name'],
                                  description=m['description'], required=m['required']))
        source = sources[('policy', definition['policy'])]
        service = dict(code=definition['code'], name=definition['name'], category=categories[definition['policy']],
                       description=definition['description'], department=definition['department'],
                       location='校园事务系统对应事项，线下窗口由受理部门告知',
                       officeHours='以受理部门公开的工作时间为准', contact='请通过受理部门公开渠道联系',
                       requirements=definition['requirements'], materials=materials,
                       recognitionRules=dict(subjects=definition['subjects'],
                           actions=['申请', '办理', '怎么办', '怎么', '如何', '我要', '我想', '流程', '步骤', '补办', '登记', '提交'],
                           exclusions=[]), deadline=definition['deadline'], sourceDocumentId=source['document_id'],
                       sourceTitle=policy_by_key[definition['policy']]['title'], sourceUrl=None,
                       sourcePublishTime=DATE, status='ACTIVE', isExample=False,
                       version=before['service']['version'] if before else 0)
        steps = [dict(order=i, title=step['title'], description=step['description'],
                      responsibleDepartment=step['department'], requiredMaterials=step['materials'],
                      location='按受理通知办理', estimatedTime='以受理或审核反馈为准')
                 for i, step in enumerate(definition['steps'], 1)]
        route = f"/api/admin/services/{old['id']}" if old else '/api/admin/services'
        saved = admin.write('PUT' if old else 'POST', route, json=dict(service=service, steps=steps))
        service_id = saved['service']['id']
        attachments = []
        for material, definition_material in zip(saved['service']['materials'], definition['materials']):
            key = definition_material['file_key']
            if not key:
                continue
            kind, identifier = key.split(':', 1) if ':' in key else ('template', key)
            record = next(r for r in manifest['documents'] if r['kind'] == kind and r['key'] == identifier)
            path = root / record['docx']
            current = material.get('attachment')
            # Download first so a repeat import does not replace identical attachments.
            same = False
            if current:
                response = admin.client.get(current.get('downloadUrl') or f"/api/admin/files/{current['id']}/download")
                if response.is_success:
                    same = hashlib.sha256(response.content).hexdigest() == record['docx_sha256']
            uploaded = current if same else admin.upload(f"/api/admin/services/{service_id}/materials/{material['id']}/attachment", path)
            response = admin.client.get(uploaded.get('downloadUrl') or f"/api/admin/files/{uploaded['id']}/download")
            response.raise_for_status()
            if hashlib.sha256(response.content).hexdigest() != record['docx_sha256']:
                raise RuntimeError(f'Attachment download integrity failed: {service_id}')
            attachments.append(dict(material_id=material['id'], filename=path.name,
                                    file_id=uploaded['id'], sha256=record['docx_sha256']))
        receipt['services'].append(dict(code=definition['code'], name=definition['name'], service_id=service_id,
            operation='updated' if old else 'created', source_document_id=source['document_id'], attachments=attachments))
        persist()
        print(f"Configured {definition['name']}: steps={len(steps)} attachments={len(attachments)}", flush=True)

    receipt['verified'] = True
    definitions = [admin.get(f"/api/admin/services/{item['service_id']}") for item in receipt['services']]
    (root / '事项配置.json').write_text(json.dumps(definitions, ensure_ascii=False, indent=2), encoding='utf-8')
    receipt['summary'] = dict(indexed_documents=len(receipt['documents']),
        chunks=sum(r['chunks'] for r in receipt['documents']), services=len(receipt['services']),
        created_services=sum(r['operation'] == 'created' for r in receipt['services']),
        attachments=sum(len(r['attachments']) for r in receipt['services']))
    persist()
    print(json.dumps(receipt['summary'], ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
