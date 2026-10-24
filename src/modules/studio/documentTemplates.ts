/** Formats offered by the new-document dialog, grouped by what they are for. */
export interface DocumentFormat {
  extension: string;
  label: string;
  description: string;
  group: "write" | "analyze" | "plan";
}

export const DOCUMENT_FORMAT_GROUPS = [
  { id: "write", label: "Write" },
  { id: "analyze", label: "Analyze" },
  { id: "plan", label: "Plan and notes" },
] as const;

export const DOCUMENT_FORMATS: readonly DocumentFormat[] = [
  {
    extension: "docx",
    label: "Word",
    description: "Styled manuscript with citation fields and comments",
    group: "write",
  },
  {
    extension: "md",
    label: "Markdown",
    description: "Plain-text notes with a live preview",
    group: "write",
  },
  {
    extension: "tex",
    label: "LaTeX",
    description: "Typeset to PDF with Tectonic",
    group: "write",
  },
  {
    extension: "typ",
    label: "Typst",
    description: "Fast typesetting to PDF",
    group: "write",
  },
  {
    extension: "myst",
    label: "MyST",
    description: "Markdown for scientific articles",
    group: "write",
  },
  {
    extension: "ipynb",
    label: "Notebook",
    description: "Python or R cells with saved outputs",
    group: "analyze",
  },
  {
    extension: "csv",
    label: "Data table",
    description: "Rows and columns for extracted evidence",
    group: "analyze",
  },
  {
    extension: "kanban",
    label: "Planning board",
    description: "Cards for tasks, reading and screening",
    group: "plan",
  },
  {
    extension: "txt",
    label: "Plain text",
    description: "Unformatted text",
    group: "plan",
  },
];

/** Every extension the editor can create as an empty or text document. */
export const NEW_DOCUMENT_EXTENSION =
  /\.(docx|md|markdown|myst|txt|tex|typ|bib|csv|tsv|jsonl|json|ipynb|kanban|py|r|yaml|yml)$/i;

export interface BuiltInTemplate {
  id: string;
  label: string;
  description: string;
  /** Default file name; its extension is the template's format. */
  name: string;
  /**
   * File text. A DOCX template holds an outline in the academic draft format
   * (# title, ## section, plain paragraphs). The editor turns the outline into
   * Title, Heading and Normal paragraphs.
   */
  text: string;
}

export const DOCUMENT_TEMPLATES: readonly BuiltInTemplate[] = [
  {
    id: "docx-article",
    label: "Research article",
    description: "Title, abstract, keywords and IMRaD sections",
    name: "article.docx",
    text: "# Research article title\n\n## Abstract\n\nSummarize the question, method, main result and limitations in about 250 words.\n\n## Keywords\n\nKeyword one; keyword two; keyword three\n\n## Introduction\n\nState the problem, the gap in prior work and the research question.\n\n## Methods\n\nDescribe the data, procedures and analysis so that another researcher could repeat them.\n\n## Results\n\nReport the findings in the order of the research questions.\n\n## Discussion\n\nInterpret the results, compare them with prior work and state the limitations.\n\n## Conclusion\n\n## References\n",
  },
  {
    id: "docx-review",
    label: "Literature review",
    description: "Question, search strategy, evidence and gaps",
    name: "literature-review.docx",
    text: "# Literature review\n\n## Research question\n\nState the question and scope.\n\n## Search and selection\n\nRecord sources, search terms and inclusion criteria.\n\n## Evidence\n\nLink each claim to a source and distinguish findings from interpretation.\n\n## Disagreements and limitations\n\n## Next steps\n",
  },
  {
    id: "markdown-review",
    label: "Literature review",
    description: "Question, search strategy, evidence and gaps",
    name: "literature-review.md",
    text: "# Literature review\n\n## Research question\n\nState the question and scope.\n\n## Search and selection\n\nRecord sources, search terms and inclusion criteria.\n\n## Evidence\n\nLink each claim to a source and distinguish findings from interpretation.\n\n## Disagreements and limitations\n\n## Next steps\n",
  },
  {
    id: "myst-article",
    label: "Research article",
    description: "Front matter with authors and IMRaD sections",
    name: "article.myst",
    text: "---\ntitle: Research article\nauthors:\n  - name: Your name\n---\n\n## Abstract\n\nSummarize the question, method, result and limitations.\n\n## Introduction\n\n## Methods\n\n## Results\n\n## Discussion\n\n## References\n",
  },
  {
    id: "latex-article",
    label: "Research article",
    description: "article class with abstract and IMRaD sections",
    name: "article.tex",
    text: String.raw`\documentclass{article}
\usepackage{graphicx}
\usepackage{amsmath}
\title{Research article}
\author{Your name}
\date{}
\begin{document}
\maketitle
\begin{abstract}
Summarize the question, method, result and limitations.
\end{abstract}
\section{Introduction}
\section{Methods}
\section{Results}
\section{Discussion}
\end{document}
`,
  },
  {
    id: "typst-article",
    label: "Research article",
    description: "A4 page setup with abstract and IMRaD sections",
    name: "article.typ",
    text: '#set document(title: "Research article", author: "Your name")\n#set page(paper: "a4", margin: 25mm)\n#set text(size: 11pt)\n\n= Research article\n\n*Your name*\n\n== Abstract\n\nSummarize the question, method, result and limitations.\n\n== Introduction\n\n== Methods\n\n== Results\n\n== Discussion\n',
  },
  {
    id: "extraction-table",
    label: "Evidence extraction",
    description: "One row per source: method, sample, finding, quote",
    name: "evidence.csv",
    text: "source_key,question,method,sample,finding,limitation,quote,location\n",
  },
];

/** Lowercase extension without the dot, or "" when the name has none. */
export function extensionOf(name: string) {
  return /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
}

export function documentFormat(extension: string) {
  return DOCUMENT_FORMATS.find((format) => format.extension === extension);
}

/** A starting point offered for one format. */
export type TemplateChoice =
  | { kind: "blank"; id: "blank"; label: string; description: string }
  | {
      kind: "builtin";
      id: string;
      label: string;
      description: string;
      template: BuiltInTemplate;
    }
  | {
      kind: "document";
      id: string;
      label: string;
      description: string;
      documentID: string;
      name: string;
    };

/**
 * Blank first, then the built-in templates and the project's own templates
 * (documents under templates/) that share the format's extension.
 */
export function templatesForFormat(
  extension: string,
  documents: ReadonlyArray<{ id: string; name: string; archived: boolean }>,
): TemplateChoice[] {
  return [
    {
      kind: "blank",
      id: "blank",
      label: "Blank",
      description: "Start from an empty file",
    },
    ...DOCUMENT_TEMPLATES.filter(
      (template) => extensionOf(template.name) === extension,
    ).map((template) => ({
      kind: "builtin" as const,
      id: template.id,
      label: template.label,
      description: template.description,
      template,
    })),
    ...documents
      .filter(
        (doc) =>
          !doc.archived &&
          doc.name.startsWith("templates/") &&
          extensionOf(doc.name) === extension,
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((doc) => ({
        kind: "document" as const,
        id: doc.id,
        label: doc.name.slice("templates/".length),
        description: "Your template · a copy keeps the original",
        documentID: doc.id,
        name: doc.name,
      })),
  ];
}

/**
 * Resolves the file the dialog creates. An empty entry uses the fallback base
 * name and picks the first free numbered variant. A typed name keeps a
 * supported extension and otherwise receives the selected one. Names are
 * compared with every catalog entry, archived ones included.
 */
export function newDocumentName(
  entered: string,
  extension: string,
  fallbackBase: string,
  existing: readonly string[],
) {
  const taken = new Set(existing);
  const typed = entered.trim();
  if (!typed) {
    const base = fallbackBase.trim() || "draft";
    let name = `${base}.${extension}`;
    for (let index = 2; taken.has(name); index++)
      name = `${base}-${index}.${extension}`;
    return name;
  }
  const name = NEW_DOCUMENT_EXTENSION.test(typed)
    ? typed
    : `${typed}.${extension}`;
  if (taken.has(name))
    throw new Error(
      "A file with this name already exists. Choose another name.",
    );
  return name;
}

/** The base of a file name: the last path segment without its extension. */
export function baseName(name: string) {
  return (name.split("/").at(-1) ?? name).replace(/\.[^.]+$/, "");
}
