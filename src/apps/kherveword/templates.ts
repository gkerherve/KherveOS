// File › New from Template: blank, letter, report and CV.

import { defaultSettings, type PMMark, type PMNode, type WordDoc } from './model'

export const TEMPLATES = [
  { id: 'blank', name: 'Blank document', description: 'An empty page' },
  { id: 'letter', name: 'Letter', description: 'A formal letter: addresses, date, subject, signature' },
  { id: 'report', name: 'Report', description: 'Title page, contents, numbered sections, a table' },
  { id: 'cv', name: 'CV / Résumé', description: 'A one-page CV with sections and a skills table' },
] as const

export type TemplateId = (typeof TEMPLATES)[number]['id']

const t = (text: string, ...marks: PMMark[]): PMNode => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
const B = { type: 'bold' }
const I = { type: 'italic' }
const p = (content: string | PMNode[] = '', attrs: Record<string, unknown> = {}): PMNode => ({
  type: 'paragraph',
  attrs: { style: 'Normal', ...attrs },
  ...(content ? { content: typeof content === 'string' ? [t(content)] : content } : {}),
})
const h = (level: number, text: string) => p(text, { style: `Heading${level}` })
const bullets = (...items: string[]): PMNode => ({ type: 'bulletList', attrs: {}, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })
const numbered = (...items: string[]): PMNode => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })

function table(rows: string[][], widths: number[], borders = 'all', header = true): PMNode {
  return {
    type: 'table',
    attrs: { borders },
    content: rows.map((r, ri) => ({
      type: 'tableRow',
      content: r.map((c, ci) => ({ type: header && ri === 0 ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [widths[ci]] }, content: [p(c)] })),
    })),
  }
}

export function templateDoc(id: TemplateId, pageSize: string): WordDoc {
  const settings = defaultSettings(pageSize)
  const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  let content: PMNode[]
  switch (id) {
    case 'letter':
      settings.title = 'Letter'
      content = [
        p('Your Name', { style: 'NoSpacing', align: 'right' }),
        p('Street and number', { style: 'NoSpacing', align: 'right' }),
        p('Postcode, City', { style: 'NoSpacing', align: 'right' }),
        p('email@example.org', { style: 'NoSpacing', align: 'right' }),
        p(),
        p('Recipient Name', { style: 'NoSpacing' }),
        p('Organisation', { style: 'NoSpacing' }),
        p('Street and number', { style: 'NoSpacing' }),
        p('Postcode, City', { style: 'NoSpacing' }),
        p(),
        p(today, { align: 'right' }),
        p([t('Subject: ', B), t('the reason for writing')]),
        p('Dear Recipient Name,'),
        p('First paragraph: say why you are writing, in a sentence or two.', { align: 'justify' }),
        p('Second paragraph: the details — what happened, what you propose, what you need, and by when.', { align: 'justify' }),
        p('Last paragraph: what happens next, and thanks for their time.', { align: 'justify' }),
        p('Yours sincerely,'),
        p(),
        p(),
        p('Your Name'),
      ]
      break
    case 'report':
      settings.title = 'Report'
      settings.footer = { left: '{TITLE}', center: '', right: 'Page {PAGE} of {PAGES}' }
      settings.differentFirst = true
      settings.firstHeader = { left: '', center: '', right: '' }
      settings.firstFooter = { left: '', center: '', right: '' }
      content = [
        p(),
        p(),
        p(),
        p('Report Title', { style: 'Title' }),
        p('A subtitle that says what the report is about', { style: 'Subtitle' }),
        p(),
        p([t('Author: ', B), t('Your Name')]),
        p([t('Date: ', B), t(today)]),
        { type: 'pageBreak', attrs: { kind: 'page' } },
        { type: 'toc' },
        { type: 'pageBreak', attrs: { kind: 'page' } },
        h(1, 'Summary'),
        p('Say in one paragraph what was done, what was found and what is recommended. Busy readers stop here.', { align: 'justify' }),
        h(1, 'Introduction'),
        p('Background, the question asked, and why it matters.', { align: 'justify' }),
        h(2, 'Scope'),
        bullets('What is included', 'What is left out', 'Assumptions'),
        h(1, 'Method'),
        p('How the work was done, so that someone else could do it again.', { align: 'justify' }),
        h(1, 'Results'),
        p([t('Table 1', B), t(' — Main results.')], { style: 'Caption' }),
        table(
          [
            ['Item', 'Value', 'Comment'],
            ['First', '1.0', ''],
            ['Second', '2.0', ''],
          ],
          [200, 120, 280],
        ),
        p(),
        h(1, 'Conclusions and recommendations'),
        numbered('First recommendation', 'Second recommendation'),
        h(1, 'References'),
        p([t('Author, A. (Year). '), t('Title of the work', I), t('. Publisher.')], { indentLeft: 36, indentFirst: -36 }),
      ]
      break
    case 'cv':
      settings.title = 'Curriculum Vitae'
      settings.page.margins = { ...settings.page.margins, top: 54, bottom: 54, left: 60, right: 60 }
      content = [
        p('Your Name', { style: 'Title', align: 'center' }),
        p('Job title · City · email@example.org · +00 000 000 000', { style: 'Subtitle', align: 'center' }),
        h(1, 'Profile'),
        p('Two or three sentences about who you are, what you are good at and what you are looking for.', { align: 'justify' }),
        h(1, 'Experience'),
        p([t('Job Title', B), t(' — Organisation, City'), t('\t2022 – now')], { tabs: [{ pos: 470, align: 'right' }], spaceAfter: 2 }),
        bullets('What you did, with a number if you can', 'Something you are proud of'),
        p([t('Previous Job', B), t(' — Organisation, City'), t('\t2018 – 2022')], { tabs: [{ pos: 470, align: 'right' }], spaceAfter: 2 }),
        bullets('Responsibility or achievement', 'Responsibility or achievement'),
        h(1, 'Education'),
        p([t('Degree', B), t(' — University, City'), t('\t2018')], { tabs: [{ pos: 470, align: 'right' }] }),
        h(1, 'Skills'),
        table(
          [
            ['Languages', 'English (fluent), French (native)'],
            ['Software', 'KherveOS, office tools, …'],
            ['Other', 'Driving licence, first aid'],
          ],
          [150, 480],
          'none',
          false,
        ),
        h(1, 'Interests'),
        p('A line about what you do outside work.'),
      ]
      break
    default:
      content = [p()]
  }
  return { doc: { type: 'doc', content }, settings }
}
