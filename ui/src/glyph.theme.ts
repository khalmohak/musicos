import { defineTheme, presets } from '@glyphui/ui'

// Monochrome listening room: deep neutral black, white as the only interface colour.
// Colour on screen comes from the album covers (see lib/color.ts), never from chrome.
export default defineTheme({
  name: 'musicos',
  extends: presets.glyph,
  colors: {
    dark: {
      background: 'oklch(12.5% 0.003 270)',
      foreground: 'oklch(97% 0 0)',
      subtle: 'oklch(15% 0.003 270)',
      surface: 'oklch(17.5% 0.003 270)',
      raised: 'oklch(20% 0.003 270)',
      muted: 'oklch(23% 0.003 270)',
      'muted-foreground': 'oklch(70% 0.004 270)',
      'faint-foreground': 'oklch(50% 0.004 270)',
      border: 'oklch(26% 0.003 270)',
      'border-strong': 'oklch(36% 0.003 270)',
      input: 'oklch(26% 0.003 270)',
      ring: 'oklch(97% 0 0)',
      primary: 'oklch(97% 0 0)',
      'primary-foreground': 'oklch(14% 0 0)',
      'primary-text': 'oklch(97% 0 0)',
      secondary: 'oklch(97% 0 0 / 0.1)',
      'secondary-foreground': 'oklch(97% 0 0)',
    },
  },
  radius: { sm: '8px', md: '12px', lg: '18px', xl: '26px', pill: '999px' },
  motion: { level: 'subtle' },
})
