// What to tell a person whose computer has no voice for the language they
// learn: where the system adds one. Voices are read once when 2Talker starts,
// so a new one shows up after a restart.

export function voiceSteps(language: string, platform: string): string {
  switch (platform) {
    case 'win32':
      return `To add one: Windows Settings → Time & language → Speech → Add voices → ${language}, then restart 2Talker.`
    case 'darwin':
      return `To add one: System Settings → Accessibility → Spoken Content → System voice → Manage Voices → ${language}, then restart 2Talker.`
    case '':
      return ''
    default:
      return 'Reading aloud uses the voices of Windows or macOS; this system has none the panel can use.'
  }
}

/** Whether the host can open the system's speech settings for the person. */
export function canOpenSpeechSettings(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin'
}
