/** On/off switch (the designers' `StSwitch`): a `role="switch"` button whose look comes from
 *  designer.css (`.st-switch` track 44×26, `.st-thumb` 20 px, blue when on). The label is its
 *  accessible name; a settings row that holds it should make the whole row the tap target.
 *  `disabled` holds the switch where it is. */
export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="st-switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="st-thumb" />
    </button>
  )
}
