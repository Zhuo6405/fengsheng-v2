import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import guide from '../docs/guide.md?raw'
import spec from '../docs/spec.md?raw'

export default function DocBody({ which }: { which: 'guide' | 'spec' }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="doc-table">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {which === 'guide' ? guide : spec}
    </Markdown>
  )
}
