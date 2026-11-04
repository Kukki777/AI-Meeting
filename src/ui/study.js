(() => {
  const $ = id => document.getElementById(id);
  let image = '';
  const status = $('status');
  function setImage(data) {
    image = data;
    $('preview').src = data;
    $('previewWrap').hidden = !data;
  }
  async function compress(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Choose an image file.');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const data = canvas.toDataURL('image/jpeg', .82);
    if (data.length > 3_600_000) throw new Error('Image is too large after compression. Choose a smaller image.');
    return data;
  }
  async function loadFile(file) {
    try { setImage(await compress(file)); status.textContent = 'Image ready.'; }
    catch (error) { status.textContent = error.message; }
  }
  $('choose').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', event => loadFile(event.target.files[0]));
  $('remove').addEventListener('click', () => { setImage(''); $('file').value = ''; });
  $('drop').addEventListener('dragover', event => { event.preventDefault(); });
  $('drop').addEventListener('drop', event => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); });
  document.addEventListener('paste', event => {
    const file = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'))?.getAsFile();
    if (file) { event.preventDefault(); loadFile(file); }
  });
  $('submit').addEventListener('click', async () => {
    const question = $('question').value.trim();
    if (!image && !question) { status.textContent = 'Add an image or type a question first.'; return; }
    const button = $('submit'); button.disabled = true; status.textContent = 'Working on your answer…'; $('answerCard').hidden = true;
    try {
      let answer;
      if (window.electronAPI?.studyImageQuestion) {
        answer = await window.electronAPI.studyImageQuestion({ image, question, subject: $('subject').value });
      } else {
        let password = sessionStorage.getItem('copilot-password') || '';
        if (!password) {
          password = window.prompt('Enter the app password to use Study Mode:') || '';
          if (!password) throw new Error('App password is required.');
          const session = await fetch('/api/session', { headers: { Authorization: `Bearer ${password}` } });
          const result = await session.json();
          if (!session.ok) throw new Error(result.error || 'Incorrect app password.');
          sessionStorage.setItem('copilot-password', password);
        }
        const response = await fetch('/api/study', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` }, body: JSON.stringify({ image, question, subject: $('subject').value }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Study request failed.');
        answer = result.answer;
      }
      $('answer').textContent = answer;
      $('answerCard').hidden = false;
      status.textContent = '';
    } catch (error) { status.textContent = error.message || 'Could not get an answer.'; }
    finally { button.disabled = false; }
  });
})();
