interface Props {
  on: boolean;
  onChange: (v: boolean) => void;
  labelledBy: string;
}

export function Switch({ on, onChange, labelledBy }: Props) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} className={`switch${on ? " is-on" : ""}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}
