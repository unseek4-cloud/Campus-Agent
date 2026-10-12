/* Each uploaded attachment has an explicit material category; the server validates coverage. */
(() => {
  function render(container, files, materials) {
    container.replaceChildren();
    if (!files.length) return;
    const hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = '为每份文件选择对应材料；上传完成后仍需管理员核验内容。';
    container.append(hint);
    [...files].forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'form-row';
      const label = document.createElement('label');
      label.htmlFor = `${container.id}-material-${index}`;
      label.textContent = file.name;
      const select = document.createElement('select');
      select.id = label.htmlFor;
      select.className = 'input';
      select.dataset.materialBinding = String(index);
      select.setAttribute('aria-label', `${file.name}对应材料`);
      select.append(new Option('其他附件 / 补充说明', ''));
      for (const material of materials) {
        select.append(new Option(`${material.required ? '必交' : '选交'} · ${material.name}`, material.id));
      }
      if (materials.length === 1) select.value = materials[0].id;
      row.append(label, select);
      container.append(row);
    });
  }
  function selection(container, files, materials, requireAll) {
    const ids = [...container.querySelectorAll('[data-material-binding]')].map(select => select.value);
    if (ids.length !== files.length) throw new Error('文件选择已变化，请重新选择文件。');
    const allowed = new Set(materials.map(material => material.id));
    if (ids.some(id => id && !allowed.has(id))) throw new Error('附件对应材料已变化，请重新选择。');
    if (requireAll) {
      const missing = materials.filter(material => material.required && !ids.includes(material.id));
      if (missing.length) throw new Error(`请逐项上传必交材料：${missing.map(material => material.name).join('、')}`);
    }
    return ids;
  }
  function append(form, files, ids) {
    [...files].forEach((file, index) => {
      form.append('files', file);
      form.append('materialIds', ids[index]);
    });
  }
  window.CampusApplicationMaterials = { render, selection, append };
})();
