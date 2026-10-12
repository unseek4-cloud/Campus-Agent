"""Verify document content and live student access after administrative import."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from zipfile import ZipFile

import httpx
from pypdf import PdfReader

from catalog import SERVICES
from import_library import Admin, read_credentials


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--url', default='http://127.0.0.1:8080')
    p.add_argument('--username', default='admin')
    p.add_argument('--credential-file', type=Path)
    p.add_argument('--student', default='20260001')
    args = p.parse_args()
    root = args.output.resolve()
    manifest = json.loads((root / '资料清单.json').read_text(encoding='utf-8'))
    receipt = json.loads((root / '知识库导入记录.json').read_text(encoding='utf-8'))
    for record in manifest['documents']:
        path = root / record['pdf']
        if hashlib.sha256(path.read_bytes()).hexdigest() != record['pdf_sha256']:
            raise RuntimeError('PDF content does not match the manifest')
        reader = PdfReader(path)
        if len(reader.pages) != record['pages']:
            raise RuntimeError('PDF page count does not match the rendering result')
        text = '\n'.join(page.extract_text() or '' for page in reader.pages)
        if any(word in text for word in ['测试', '示例', '演示']):
            raise RuntimeError('Administrative document contains an unwanted label')
        if len(text.strip()) < 100 or record['title'] not in text.replace(' ', '').replace('\n', ''):
            raise RuntimeError('Document text is missing or title extraction failed')
        with ZipFile(root / record['docx']) as package:
            xml = package.read('word/document.xml').decode('utf-8')
            if any(word in xml for word in ['测试', '示例', '演示']):
                raise RuntimeError('Editable document contains an unwanted label')
    admin = Admin(args.url, args.username, read_credentials(args))
    for document in receipt['documents']:
        actual = admin.get('/api/admin/documents/' + document['document_id'])
        if actual['status'] != 'SUCCESS' or actual['fileHash'] != document['sha256'] or actual['chunkCount'] < 1:
            raise RuntimeError('Live knowledge document integrity check failed')

    client = httpx.Client(base_url=args.url, trust_env=False, timeout=180)
    csrf = Admin.data(client.get('/api/auth/csrf'))
    credentials = args.credential_file.read_text(encoding='utf-8') if args.credential_file else ''
    password_match = re.search(r'^' + re.escape(args.student) + r'\s*:\s*(.+)$', credentials, re.M)
    if not password_match:
        raise RuntimeError('Student credential is required to verify student access')
    Admin.data(client.post('/api/auth/login', headers={csrf['headerName']: csrf['token']},
                          json={'username': args.student, 'password': password_match.group(1).strip()}))
    csrf = Admin.data(client.get('/api/auth/csrf'))
    headers = {csrf['headerName']: csrf['token']}
    user = Admin.data(client.get('/api/auth/me'))
    if user['role'] != 'STUDENT':
        raise RuntimeError('Student access must be checked with a student account')
    results = []
    indexed = {d['document_id']: d for d in receipt['documents']}
    for item in receipt['services']:
        detail = Admin.data(client.get(f"/api/services/{item['service_id']}"))
        service = detail['service']
        if service['isExample'] or service['status'] != 'ACTIVE' or len(detail['steps']) != 5:
            raise RuntimeError('Service configuration is incomplete')
        if service['sourceDocumentId'] != item['source_document_id']:
            raise RuntimeError('Service policy reference is incorrect')
        serialized = json.dumps(detail, ensure_ascii=False)
        if any(word in serialized for word in ['测试', '示例', '演示']):
            raise RuntimeError('Service has an unwanted label')
        response = client.get(f"/api/services/{item['service_id']}/source")
        response.raise_for_status()
        if hashlib.sha256(response.content).hexdigest() != indexed[item['source_document_id']]['sha256']:
            raise RuntimeError('Student policy download failed integrity verification')
        for material in service['materials']:
            attachment = material.get('attachment')
            if not attachment:
                continue
            response = client.get(attachment['downloadUrl'])
            response.raise_for_status()
            expected = next(a for a in item['attachments'] if a['file_id'] == attachment['id'])
            if hashlib.sha256(response.content).hexdigest() != expected['sha256']:
                raise RuntimeError('Student attachment download failed integrity verification')
        query = service['name'] + '应该怎么办，办理流程是什么？'
        recognized = Admin.data(client.post('/api/services/recognize', headers=headers, json={'query': query}))
        if recognized.get('serviceCode') != service['code'] or recognized.get('queryIntent') != 'SERVICE_GUIDE':
            raise RuntimeError('Service query recognition failed: ' + service['code'])
        results.append(dict(code=service['code'], source_download=True,
                            attachment_count=len(item['attachments']), recognized=True))
        print(f"Verified student access: {service['name']}", flush=True)

    searches = []
    for query in ['家庭经济困难认定是否需要村镇盖章', '借阅图书遗失后如何处理', '复学需要提交哪些材料']:
        answer = Admin.data(client.post('/api/knowledge/search', headers=headers,
                                       json={'query': query, 'topK': 5}))
        hits = answer.get('results', [])
        matched = [h for h in hits if h.get('documentId') in indexed]
        if not matched:
            raise RuntimeError('A library search did not retrieve the imported documents')
        searches.append(dict(query=query, files=[h.get('fileName') for h in matched]))
        print(f'Verified retrieval: {query}', flush=True)

    chat = Admin.data(client.post('/api/rag/chat', headers=headers,
        json={'query': '我要办理休学，申请流程是什么？'}))
    if chat.get('type') != 'SERVICE_GUIDE' or len(chat.get('steps', [])) != 5:
        raise RuntimeError('Student chat did not return the configured workflow')
    report = dict(document_count=len(manifest['documents']), docx_count=len(manifest['documents']),
                  pdf_count=len(manifest['documents']), pages=sum(r['pages'] for r in manifest['documents']),
                  indexed_documents=len(receipt['documents']), services=results, searches=searches,
                  workflow_chat=True, administrative_labels_clear=True)
    (root / '资料与访问核验记录.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k not in ('services', 'searches')}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
