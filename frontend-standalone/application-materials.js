/* Uploads are grouped by requirement and bound to that material automatically. */
(() => {
  const pickers = new WeakMap();
  function render(container, materials, { accept = '' } = {}) {
    container.replaceChildren();
    const groups = [...materials.map(material => ({ ...material, files: [] })),
      { id: '', name: '其他附件 / 补充说明', required: false, files: [] }];
    pickers.set(container, groups);
    groups.forEach((group, index) => {
      const card = document.createElement('div');
      card.className = 'application-material-upload';
      const heading = document.createElement('div');
      heading.className = 'material-upload-heading';
      const label = document.createElement('label');
      label.htmlFor = `${container.id}-upload-${index}`;
      label.textContent = `${group.required ? '必交 · ' : '选交 · '}${group.name}`;
      const status = document.createElement('span');
      status.className = 'material-upload-status';
      heading.append(label, status);
      card.append(heading);
      if (group.description) {
        const description = document.createElement('p');
        description.className = 'form-hint';
        description.textContent = group.description;
        card.append(description);
      }
      const input = document.createElement('input');
      input.id = label.htmlFor;
      input.type = 'file';
      input.multiple = true;
      input.accept = accept;
      input.className = 'input';
      input.dataset.materialUpload = group.id;
      input.setAttribute('aria-label', `上传${group.name}`);
      const list = document.createElement('div');
      list.className = 'material-upload-files';
      function paint() {
        status.textContent = group.files.length ? `已选择 ${group.files.length} 份` : group.required ? '待上传' : '可选';
        status.classList.toggle('is-ready', group.files.length > 0);
        list.replaceChildren();
        group.files.forEach((file, fileIndex) => {
          const row = document.createElement('div');
          row.className = 'material-upload-file';
          const name = document.createElement('span');
          name.textContent = `${file.name} · ${Math.ceil(file.size / 1024)} KB`;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'btn btn-sm';
          remove.textContent = '移除';
          remove.setAttribute('aria-label', `移除${file.name}`);
          remove.addEventListener('click', () => {
            group.files.splice(fileIndex, 1);
            input.value = '';
            paint();
            container.dispatchEvent(new Event('change', { bubbles: true }));
          });
          row.append(name, remove);
          list.append(row);
        });
      }
      input.addEventListener('change', () => {
        group.files.push(...input.files);
        input.value = '';
        paint();
      });
      const picker = document.createElement('label');
      picker.className = 'btn btn-sm material-upload-picker';
      const caption = document.createElement('span');
      caption.textContent = '选择文件';
      picker.append(caption, input);
      card.append(picker, list);
      container.append(card);
      paint();
    });
  }
  function selection(container, requireAll) {
    const groups = pickers.get(container);
    if (!groups) throw new Error('材料要求尚未加载，请重新打开申请表单。');
    if (requireAll) {
      const missing = groups.filter(group => group.required && !group.files.length);
      if (missing.length) throw new Error(`请逐项上传必交材料：${missing.map(group => group.name).join('、')}`);
    }
    return { files: groups.flatMap(group => group.files),
      ids: groups.flatMap(group => group.files.map(() => group.id)) };
  }
  function append(form, files, ids) {
    [...files].forEach((file, index) => {
      form.append('files', file);
      form.append('materialIds', ids[index]);
    });
  }
  function disable(container, disabled) {
    container.querySelectorAll('input, button').forEach(control => control.disabled = disabled);
  }
  window.CampusApplicationMaterials = { render, selection, append, disable };
})();
