export function bindPasswordConfirmation(target: HTMLFormElement) {
  const original = target.elements.namedItem('password') as HTMLInputElement;
  const confirmation = target.elements.namedItem('confirmPassword') as HTMLInputElement;
  const validate = () => confirmation.setCustomValidity(!confirmation.disabled && confirmation.value && confirmation.value !== original.value ? '两次输入的密码不一致，请重新确认。' : '');
  original.addEventListener('input', validate);
  confirmation.addEventListener('input', validate);
  target.addEventListener('reset', () => confirmation.setCustomValidity(''));
  return validate;
}
