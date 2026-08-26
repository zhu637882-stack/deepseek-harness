import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type QingmuBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/** Render the original Qingmu Q, play glyph, and sprouting leaf mark. */
export function QingmuBrandMark({ size, className }: QingmuBrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <circle cx="11.25" cy="12.25" fill="none" r="7.15" stroke="currentColor" strokeWidth="2.2" />
      <path d="M16.45 17.2 20.25 20.55" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
      <path d="M10.1 8.75 15.45 12.25 10.1 15.75Z" fill="currentColor" />
      <path d="M11.7 5.05C12.05 2.55 13.65 1.15 16.45 1c-.25 2.55-1.85 3.95-4.75 4.05Z" fill="currentColor" />
    </svg>
  )
}

/** Render the public Qingmu OS product name without a duplicated mark. */
export function QingmuBrandName() {
  return <span lang="zh-CN">青木 OS</span>
}
