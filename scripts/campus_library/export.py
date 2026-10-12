"""Copy verified deliverables to a requested directory without touching other files."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from zipfile import ZipFile, ZIP_DEFLATED


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--destination', type=Path, required=True)
    args = p.parse_args()
    root = args.output.resolve()
    destination = args.destination.resolve()
    manifest = json.loads((root / '资料清单.json').read_text(encoding='utf-8'))
    report = json.loads((root / '资料与访问核验记录.json').read_text(encoding='utf-8'))
    if report['indexed_documents'] != manifest['document_count'] or not report['workflow_chat']:
        raise RuntimeError('Complete library verification is required before export')
    files = [r[format] for r in manifest['documents'] for format in ('docx', 'pdf')]
    files += ['知识库导入记录.json', '资料与访问核验记录.json', '事项配置.json']
    destination.mkdir(parents=True, exist_ok=True)
    for relative in files:
        source, target = (root / relative).resolve(), (destination / relative).resolve()
        if not source.is_relative_to(root) or not target.is_relative_to(destination):
            raise ValueError('Artifact path must stay inside its designated directory')
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.read_bytes() != source.read_bytes():
            shutil.copyfile(source, target)
        if hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(target.read_bytes()).digest():
            raise RuntimeError('Export integrity verification failed')
    for record in manifest['documents']:
        record.pop('qa_directory', None)
    (destination / '资料清单.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    files.append('资料清单.json')
    archive = destination / '校园事务制度与办事资料.zip'
    with ZipFile(archive, 'w', ZIP_DEFLATED) as package:
        for relative in files:
            package.write(destination / relative, Path(relative).as_posix())
    with ZipFile(archive) as package:
        if package.testzip() is not None or len(package.namelist()) != len(files):
            raise RuntimeError('Archive integrity check failed')
    print(json.dumps({'docx': manifest['document_count'], 'pdf': manifest['document_count'],
                      'destination': str(destination), 'archive': str(archive),
                      'copied_files': len(files)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
