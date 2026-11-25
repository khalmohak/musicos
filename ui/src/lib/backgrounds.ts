// Photography for setup, settings, empty states and the idle screensaver.
// All from Unsplash (https://unsplash.com/license), credited in Settings > About.
export interface Backdrop {
  src: string
  by: string
  url: string
  /** where the subject sits, so text can go on the quieter side */
  focus: string
}

export const BACKDROPS: Backdrop[] = [
  { src: '/backgrounds/decks.jpg', by: 'Dalibor Bosnjakovic', url: 'https://unsplash.com/photos/Zfg9GZ7yLcU', focus: '50% 60%' },
  { src: '/backgrounds/sony.jpg', by: 'Giovanni Randisi', url: 'https://unsplash.com/photos/C-LtpT0au3I', focus: '50% 45%' },
  { src: '/backgrounds/stage.jpg', by: 'Jordan McDonald', url: 'https://unsplash.com/photos/xLG3BBiuT1Q', focus: '40% 40%' },
  { src: '/backgrounds/needle.jpg', by: 'Ivan Dorofeev', url: 'https://unsplash.com/photos/bsLXJsucvxc', focus: '35% 50%' },
  { src: '/backgrounds/platter.jpg', by: 'Lee Campbell', url: 'https://unsplash.com/photos/4f_Kk-AYf64', focus: '50% 55%' },
]

export const backdrop = (i: number) => BACKDROPS[((i % BACKDROPS.length) + BACKDROPS.length) % BACKDROPS.length]
