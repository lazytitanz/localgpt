import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const MAX_INLINE_SNIPPET_LENGTH = 100;
const MAX_INLINE_SNIPPET_LINES = 1;

function InlineSnippet({ code }) {
  return (
    <span className="message-markdown__snippet">
      <code className="message-markdown__snippet-code">{code}</code>
    </span>
  );
}

function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);
  const lang = (language || "").trim().replace(/^language-/, "") || "text";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="code-block">
      <div className="code-block__header">
        {lang && lang !== "text" && <span className="code-block__lang">{lang}</span>}
        <button
          type="button"
          className="code-block__copy"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        PreTag="div"
        codeTagProps={{ className: "code-block__pre" }}
        customStyle={{
          margin: 0,
          padding: "12px 16px",
          borderRadius: "0 0 var(--radius-md) var(--radius-md)",
          fontSize: "0.875rem",
          lineHeight: 1.5,
        }}
        showLineNumbers={false}
      >
        {String(code).replace(/\n$/, "")}
      </SyntaxHighlighter>
    </div>
  );
}

const markdownComponents = {
  p: ({ children }) => <p className="message-markdown__p">{children}</p>,
  strong: ({ children }) => <strong className="message-markdown__strong">{children}</strong>,
  em: ({ children }) => <em className="message-markdown__em">{children}</em>,
  del: ({ children }) => <del className="message-markdown__del">{children}</del>,
  h1: ({ children }) => <h1 className="message-markdown__h1">{children}</h1>,
  h2: ({ children }) => <h2 className="message-markdown__h2">{children}</h2>,
  h3: ({ children }) => <h3 className="message-markdown__h3">{children}</h3>,
  ul: ({ children }) => <ul className="message-markdown__ul">{children}</ul>,
  ol: ({ children }) => <ol className="message-markdown__ol">{children}</ol>,
  li: ({ children }) => <li className="message-markdown__li">{children}</li>,
  blockquote: ({ children }) => <blockquote className="message-markdown__blockquote">{children}</blockquote>,
  table: ({ children }) => <table className="message-markdown__table">{children}</table>,
  thead: ({ children }) => <thead className="message-markdown__thead">{children}</thead>,
  tbody: ({ children }) => <tbody className="message-markdown__tbody">{children}</tbody>,
  tr: ({ children }) => <tr className="message-markdown__tr">{children}</tr>,
  th: ({ children }) => <th className="message-markdown__th">{children}</th>,
  td: ({ children }) => <td className="message-markdown__td">{children}</td>,
  a: ({ href, children }) => {
    const label = (Array.isArray(children) ? children : [children]).reduce((acc, c) => acc + (typeof c === "string" ? c : ""), "").trim();
    const isCitation = label.startsWith("Source: ");
    return (
      <a
        href={href}
        className={isCitation ? "message-markdown__a message-markdown__cite" : "message-markdown__a"}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  code: ({ node, inline, className, children, ...props }) => {
    if (inline) {
      return (
        <code className="message-markdown__inline-code" {...props}>
          {children}
        </code>
      );
    }
    const lang = (className || "").replace(/^language-/, "");
    const code = String(children).replace(/\n$/, "");
    const lines = code.split("\n");
    const isShortSnippet =
      lines.length <= MAX_INLINE_SNIPPET_LINES && code.length <= MAX_INLINE_SNIPPET_LENGTH;
    if (isShortSnippet) {
      return <InlineSnippet code={code} />;
    }
    return <CodeBlock code={code} language={lang} />;
  },
};

export default function MarkdownMessage({ content }) {
  if (!content) return null;
  return (
    <div className="message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
