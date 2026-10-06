/** On/off switch (the designers' `StSwitch`): a `role="switch"` button whose look comes from
 *  designer.css (`.st-switch` track 44×26, `.st-thumb` 20 px, blue when on). The label is its
 *  accessible name; a settings row that holds it should make the whole row the tap target. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="st-switch" onClick={() => onChange(!checked)}>
      <span className="st-thumb" />
    </button>
  )
}
