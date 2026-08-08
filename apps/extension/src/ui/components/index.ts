/**
 * ui/components/index.ts — the extension's entire design system.
 *
 * SEC 14.1 R-3: `apps/extension` may import only `@repo/types`, `@repo/rotation`,
 * `@repo/typescript-config` and `@repo/eslint-config`. `@repo/ui` is off limits, so the popup and
 * the Options app are built from these eleven primitives and nothing else.
 */

export { Button, Spinner } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export {
  Badge,
  KEY_STATUS_LABEL,
  KEY_STATUS_TONE,
  KeyStatusBadge,
  Meter,
  StatusDot,
} from './Badge';
export type { BadgeTone } from './Badge';

export { cx } from './cx';
export type { ClassValue } from './cx';

export { Field, FieldGrid, FieldSet } from './Field';
export type { FieldProps, FieldRenderProps } from './Field';

export { Input, Select, Switch, Textarea } from './Input';
export { ChipList, Repeater } from './ListEditor';
export type { RepeaterProps } from './ListEditor';
export type { InputProps, SelectProps, SwitchProps, TextareaProps } from './Input';

export { Card, EmptyState, Notice, PanelHeader, Stat } from './Layout';
export type { NoticeTone } from './Layout';

export { ConfirmModal, Modal } from './Modal';
export type { ModalProps } from './Modal';

export { Table, nextSort } from './Table';
export type { Column, SortDirection, SortState, TableProps } from './Table';

export { TabPanel, Tabs } from './Tabs';
export type { TabItem, TabsProps } from './Tabs';

export { ToastHost, toast, useToastStore } from './Toast';
export type { ToastRecord } from './Toast';
