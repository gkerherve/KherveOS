// Who made KherveOS: shown in Settings › About. Edit the text here.

export const AUTHOR = {
  name: 'Gwilherm Kerherve',
  affiliation: 'Imperial College London',
  /** One line under the name. */
  role: 'Creator of the Kherve Tools and KherveOS',
  /** A short paragraph. */
  about:
    'Gwilherm builds scientific software at Imperial College London: the Kherve Tools, such as KherveFitting for ' +
    'XPS peak fitting, made free and open source so that anyone can analyse their data. KherveOS brings these tools, and ' +
    'more, together in a desktop that runs in the browser.',
  links: [{ label: 'Ktools website', url: 'https://khervetools.com' }],
} as const

export const COPYRIGHT = `© ${new Date().getFullYear()} ${AUTHOR.name}`
