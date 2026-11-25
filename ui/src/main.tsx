import { GlyphProvider } from '@glyphui/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import theme from './glyph.theme'
import './index.css'
import { Phone } from './screens/Phone'

const isPhone = window.location.pathname.startsWith('/phone')

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <GlyphProvider theme={theme} defaultMode="dark" storageKey={null} toaster={isPhone}>
      {isPhone ? <Phone /> : <App />}
    </GlyphProvider>
  </StrictMode>,
)
