"""Render the generated DOCX files through the packaged document renderer."""
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--qa', type=Path, required=True)
    p.add_argument('--renderer', type=Path, required=True)
    p.add_argument('--converter-directory', type=Path, required=True)
    p.add_argument('--limit', type=int)
    args = p.parse_args()
    os.environ['PATH'] = str(args.converter_directory.resolve()) + os.pathsep + os.environ['PATH']
    spec = importlib.util.spec_from_file_location('campus_docx_renderer', args.renderer)
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    root = args.output.resolve()
    qa = args.qa.resolve()
    manifest_path = root / '资料清单.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for i, record in enumerate(manifest['documents'][:args.limit], 1):
        target = qa / f'{i:03d}'
        pdf_path = root / record['pdf']
        if record.get('pdf_sha256') and pdf_path.exists() and list(target.glob('page-*.png')):
            print(f'{i:03d} cached {record["kind"]}', flush=True)
            continue
        for image in target.glob('page-*.png'):
            image.unlink()
        pages = renderer.rasterize(str(root / record['docx']), str(target), 130, False, True)
        converted = target / pdf_path.name
        shutil.copyfile(converted, pdf_path)
        record['pdf_sha256'] = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
        record['pages'] = len(pages)
        record['qa_directory'] = str(target)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'{i:03d} rendered {record["kind"]} pages={len(pages)} {record["title"]}', flush=True)
    print('Rendering complete', flush=True)


if __name__ == '__main__':
    main()
