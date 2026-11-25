import { ArrowBigUp, ArrowRight, Delete, Hash, Space } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { type RemoteKey, useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'

type Layout = 'name' | 'full'
type Layer = 'lower' | 'upper' | 'symbols'

const NAME_ROWS = ['abcdefghi', 'jklmnopqr', 'stuvwxyz-']
const FULL: Record<Layer, string[]> = {
  lower: ['1234567890', 'qwertyuiop', 'asdfghjkl.', 'zxcvbnm-_@'],
  upper: ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL.', 'ZXCVBNM-_@'],
  symbols: ['1234567890', '!#$%&*+=?/', ':;,"\'()[]~', '<>{}^|\\`.@'],
}
const ACTION_ICON: Record<string, { icon: typeof Space; label: string }> = {
  space: { icon: Space, label: 'Space' },
  delete: { icon: Delete, label: 'Delete' },
  done: { icon: ArrowRight, label: 'Done' },
  shift: { icon: ArrowBigUp, label: 'Shift' },
  symbols: { icon: Hash, label: '#+=' },
}

/**
 * Remote-friendly keyboard: arrows move, OK types. A physical keyboard types directly too.
 * `name` capitalises words; `full` (passwords) has shift and symbol layers and never alters input.
 */
export function OnScreenKeyboard({
  value, onChange, onDone, layout = 'name', maxLength = 64, doneLabel, onEdge, active = true, showFocus = true,
}: {
  value: string
  onChange: (v: string) => void
  onDone: () => void
  layout?: Layout
  maxLength?: number
  doneLabel?: string
  /** called when the user pushes past an edge; return true if focus moved elsewhere */
  onEdge?: (dir: 'up' | 'down' | 'left' | 'right') => boolean
  /** false while another part of the screen has focus */
  active?: boolean
  showFocus?: boolean
}) {
  const [layer, setLayer] = useState<Layer>('lower')
  const [row, setRow] = useState(layout === 'full' ? 1 : 0)
  const [col, setCol] = useState(0)
  const chars = layout === 'name' ? NAME_ROWS : FULL[layer]
  const actions = layout === 'name' ? ['space', 'delete', 'done'] : ['shift', 'symbols', 'space', 'delete', 'done']
  const grid: string[][] = [...chars.map((r) => r.split('')), actions]

  const type = (ch: string) => {
    if (value.length >= maxLength) return sfx.edge()
    sfx.tick()
    const next = value + ch
    onChange(layout === 'name' ? next.replace(/(^|\s)([a-z])/g, (_, s, c: string) => s + c.toUpperCase()) : next)
    if (layer === 'upper') setLayer('lower') // one-shot shift
  }

  const press = (key: string) => {
    if (key === 'done') {
      sfx.select()
      return onDone()
    }
    if (key === 'delete') {
      sfx.tick()
      return onChange(value.slice(0, -1))
    }
    if (key === 'shift') {
      sfx.tick()
      return setLayer((l) => (l === 'upper' ? 'lower' : 'upper'))
    }
    if (key === 'symbols') {
      sfx.tick()
      return setLayer((l) => (l === 'symbols' ? 'lower' : 'symbols'))
    }
    type(key === 'space' ? ' ' : key)
  }

  // moving between rows of different lengths keeps the horizontal position
  const mapCol = (c: number, from: number, to: number) =>
    grid[from].length === grid[to].length ? c : Math.round((c / Math.max(1, grid[from].length - 1)) * (grid[to].length - 1))

  useRemote((k: RemoteKey, e) => {
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      if (layout === 'name' && !/[a-zA-Z \-]/.test(e.key)) return true
      type(layout === 'name' ? e.key.toLowerCase() : e.key)
      return true
    }
    if (e.key === 'Backspace') {
      press('delete')
      return true
    }
    const move = (r: number, c: number) => {
      setRow(r)
      setCol(c)
      sfx.tick()
    }
    if (k === 'up' && row > 0) move(row - 1, mapCol(col, row, row - 1))
    else if (k === 'down' && row < grid.length - 1) move(row + 1, mapCol(col, row, row + 1))
    else if (k === 'left' && col > 0) move(row, col - 1)
    else if (k === 'right' && col < grid[row].length - 1) move(row, col + 1)
    else if (k === 'ok') press(grid[row][Math.min(col, grid[row].length - 1)])
    else if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      if (!onEdge?.(k)) sfx.edge()
    } else return false
    return true
  }, active)

  const cell = (on: boolean, extra: string, content: ReactNode, value: string, id: string) => (
    <div
      key={id}
      onMouseDown={() => press(value)}
      className={`flex h-[3rem] items-center justify-center gap-2 rounded-[0.8rem] text-[1.1rem] font-medium transition-[transform,background-color,color] duration-150 ${extra} ${
        on && showFocus ? 'scale-110 bg-white text-[rgb(12_12_14)]' : 'bg-white/[0.07] text-white/75'
      }`}
    >
      {content}
    </div>
  )
  const narrow = layout === 'name' ? 'w-[3.1rem]' : 'w-[2.9rem]'
  const actionWidth = layout === 'name' ? 'w-[9.9rem]' : 'w-[5.7rem]'

  return (
    <div className="inline-flex flex-col gap-2">
      {grid.slice(0, -1).map((keys, r) => (
        <div key={r} className="flex justify-center gap-2">
          {keys.map((key, c) => cell(r === row && c === col, `${narrow} ${layout === 'name' ? 'uppercase' : ''}`, key, key, `${r}-${c}`))}
        </div>
      ))}
      <div className="flex justify-center gap-2">
        {actions.map((key, c) => {
          const a = ACTION_ICON[key]
          const active = (key === 'shift' && layer === 'upper') || (key === 'symbols' && layer === 'symbols')
          return cell(
            row === grid.length - 1 && c === col,
            `${actionWidth} text-[0.9rem] ${active ? 'ring-1 ring-white/60' : ''}`,
            <>
              <a.icon className="size-[1.1rem]" strokeWidth={2} />
              {key === 'done' && doneLabel ? doneLabel : a.label}
            </>,
            key,
            key,
          )
        })}
      </div>
    </div>
  )
}
