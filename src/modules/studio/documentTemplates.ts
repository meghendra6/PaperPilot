export const DOCUMENT_TEMPLATES = [
  {
    id: "markdown-review",
    label: "Literature review · Markdown",
    name: "literature-review.md",
    text: "# Literature review\n\n## Research question\n\nState the question and scope.\n\n## Search and selection\n\nRecord sources, search terms and inclusion criteria.\n\n## Evidence\n\nLink each claim to a source and distinguish findings from interpretation.\n\n## Disagreements and limitations\n\n## Next steps\n",
  },
  {
    id: "myst-article",
    label: "Research article · MyST",
    name: "article.myst",
    text: "---\ntitle: Research article\nauthors:\n  - name: Your name\n---\n\n## Abstract\n\nSummarize the question, method, result and limitations.\n\n## Introduction\n\n## Methods\n\n## Results\n\n## Discussion\n\n## References\n",
  },
  {
    id: "latex-article",
    label: "Research article · LaTeX",
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
    label: "Research article · Typst",
    name: "article.typ",
    text: '#set document(title: "Research article", author: "Your name")\n#set page(paper: "a4", margin: 25mm)\n#set text(size: 11pt)\n\n= Research article\n\n*Your name*\n\n== Abstract\n\nSummarize the question, method, result and limitations.\n\n== Introduction\n\n== Methods\n\n== Results\n\n== Discussion\n',
  },
  {
    id: "extraction-table",
    label: "Evidence extraction · CSV",
    name: "evidence.csv",
    text: "source_key,question,method,sample,finding,limitation,quote,location\n",
  },
] as const;

export function templateDestination(name: string, sourceName: string) {
  const destination = name.trim() || sourceName.replace(/^templates\//, "");
  const extension = sourceName.match(/\.[^./]+$/)?.[0]?.toLowerCase();
  if (!extension || !destination.toLowerCase().endsWith(extension))
    throw new Error(
      "Keep the template's file extension; changing it does not convert the document.",
    );
  return destination;
}
