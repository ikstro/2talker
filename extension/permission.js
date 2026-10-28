// Chrome asks for the microphone only on a page it can show: this one. The
// offscreen recorder then has it too, since both are the extension's.

const result = document.getElementById('result')

document.getElementById('allow').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    result.textContent = 'Done. You can close this tab.'
  } catch (error) {
    result.textContent = `Did not work: ${error.message}. Check that the microphone is allowed in Windows' privacy settings.`
  }
})
