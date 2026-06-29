import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'ob', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        // Allow attribute selectors too: ObjectRowComponent is `tr[ob-object-row]`
        // (attribute on a real <tr> to preserve table semantics). Prefix `ob` and
        // kebab-case are still enforced for both forms.
        { type: ['element', 'attribute'], prefix: 'ob', style: 'kebab-case' },
      ],
    },
  },
  {
    // Accessibility rules re-enabled to `error` (STORY-0616 / TASK-1887) now that
    // the screens are rebuilt on the design system.
    //
    // Scope to *.html only: the `@angular-eslint/template` plugin is registered
    // for templates (real .html + inline templates extracted by the angular
    // processor into virtual .html), NOT for .ts source. Listing *.component.ts
    // here referenced a plugin that isn't in scope for .ts files, which threw
    // "Could not find plugin @angular-eslint/template" and aborted the whole run.
    files: ['**/*.html'],
    rules: {
      '@angular-eslint/template/elements-content': 'error',
      '@angular-eslint/template/click-events-have-key-events': 'error',
      '@angular-eslint/template/interactive-supports-focus': 'error',
      '@angular-eslint/template/label-has-associated-control': [
        'error',
        // spartan-ng custom form controls count as the labelled control.
        { controlComponents: ['hlm-checkbox', 'hlm-switch', 'brn-checkbox'] },
      ],
      '@angular-eslint/template/valid-aria': 'error',
    },
  },
];
