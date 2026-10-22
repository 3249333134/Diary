import { RadioGroup, Radio } from 'react-aria-components';
import { Check } from 'lucide-react';
import './plan-controls.css';

type Choice = { value: string; label: string; color?: string; disabled?: boolean };
export function GlassChoices({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: Choice[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  return <RadioGroup aria-label={label} value={value} onChange={onChange} isDisabled={disabled} className="glass-choices">
    {options.map(option => <Radio key={option.value} value={option.value} isDisabled={option.disabled} className="glass-choice">
      <span className="glass-choice-check" aria-hidden="true"><Check size={13}/></span>
      {option.color && <i className="glass-choice-dot" style={{background: option.color}} aria-hidden="true"/>}
      <span>{option.label}</span>
    </Radio>)}
  </RadioGroup>;
}
