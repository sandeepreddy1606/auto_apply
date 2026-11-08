'use client'

/**
 * CodeMirror 6 LaTeX editor, loaded in the browser only. Highlights compile
 * error lines, supports Ctrl/Cmd+S, and can jump to a line on request.
 */
import { useEffect, useRef } from 'react'

import type { EditorView } from '@codemirror/view'

export interface LatexEditorProps {
  value: string
  onChange: (v: string) => void
  onSave?: () => void
  errorLines?: number[]
  jumpTo?: { line: number; n: number } | null
  readOnly?: boolean
}

export default function LatexEditor({ value, onChange, onSave, errorLines = [], jumpTo, readOnly }: LatexEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cb = useRef({ onChange, onSave })
  cb.current = { onChange, onSave }
  const mods = useRef<{
    setErrors?: (lines: number[]) => void
    setReadOnly?: (ro: boolean) => void
  }>({})

  useEffect(() => {
    let destroyed = false
    ;(async () => {
      const [{ basicSetup }, viewMod, stateMod, lang, legacy] = await Promise.all([
        import('codemirror'),
        import('@codemirror/view'),
        import('@codemirror/state'),
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/stex'),
      ])
      if (destroyed || !host.current) return
      const { EditorView: EV, Decoration, keymap } = viewMod
      const { EditorState, StateEffect, StateField, Compartment } = stateMod

      const setErr = StateEffect.define<number[]>()
      const errField = StateField.define({
        create: () => Decoration.none,
        update(deco, tr) {
          for (const e of tr.effects) {
            if (e.is(setErr)) {
              const marks = e.value
                .filter((l) => l >= 1 && l <= tr.state.doc.lines)
                .sort((a, b) => a - b)
                .map((l) => Decoration.line({ class: 'cm-err-line' }).range(tr.state.doc.line(l).from))
              return Decoration.set(marks, true)
            }
          }
          return deco.map(tr.changes)
        },
        provide: (f) => EV.decorations.from(f),
      })
      const ro = new Compartment()
      const v = new EV({
        parent: host.current,
        state: EditorState.create({
          doc: value,
          extensions: [
            basicSetup,
            lang.StreamLanguage.define(legacy.stex),
            EV.lineWrapping,
            errField,
            ro.of(EditorState.readOnly.of(!!readOnly)),
            keymap.of([
              {
                key: 'Mod-s',
                preventDefault: true,
                run: () => {
                  cb.current.onSave?.()
                  return true
                },
              },
            ]),
            EV.updateListener.of((u) => {
              if (u.docChanged) cb.current.onChange(u.state.doc.toString())
            }),
            EV.theme({}, { dark: true }),
          ],
        }),
      })
      view.current = v
      mods.current = {
        setErrors: (lines) => v.dispatch({ effects: setErr.of(lines) }),
        setReadOnly: (r) => v.dispatch({ effects: ro.reconfigure(EditorState.readOnly.of(r)) }),
      }
      mods.current.setErrors?.(errorLines)
    })()
    return () => {
      destroyed = true
      view.current?.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External value changes (switching versions) replace the document.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  useEffect(() => mods.current.setErrors?.(errorLines), [errorLines])
  useEffect(() => mods.current.setReadOnly?.(!!readOnly), [readOnly])

  useEffect(() => {
    const v = view.current
    if (!v || !jumpTo) return
    const line = v.state.doc.line(Math.min(Math.max(1, jumpTo.line), v.state.doc.lines))
    v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    v.focus()
  }, [jumpTo])

  return <div className="cm-host" ref={host} />
}
