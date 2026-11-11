// The choices behind the Home tab's split buttons and menus: underline styles, strikethrough, text effects, change
// case, bullets, numbering, line spacing, shading, and borders. Each is a list of menu items that run a catalog
// command with the choice as its argument. Owner: text:home-tab-ui (B10).
import { createElement } from 'react';
import type { CommandId } from '../../../commands/types';
import type { EditorCommandArgs } from '../../../editor/commands/catalog';
import { CASE_MODES } from '../../../editor/commands/changeCase';
import { BULLET_LIBRARY, MULTILEVEL_PRESETS, NUMBER_LIBRARY } from '../../../editor/commands/lists';
import { UNDERLINE_STYLES } from '../../../editor/schema/constants';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import type { IconComponent, MenuItemSpec } from '../../../ui';
import { resolveColor } from '../../../ui/color';
import type { Scheme } from '../../../ui/color';
import { run } from './run';

const item = (id: string, label: string, onSelect: () => void, extra: Partial<MenuItemSpec> = {}): MenuItemSpec => ({
  id,
  label,
  onSelect,
  ...extra,
});

const go =
  (command: CommandId, args: EditorCommandArgs): (() => void) =>
  () =>
    run(command, args);

/** The underline styles the menu offers by name; the rest of the 17 are in the Format pane. */
const UNDERLINE_MENU = [
  'single',
  'double',
  'words',
  'thick',
  'dotted',
  'dash',
  'dashLong',
  'dotDash',
  'dotDotDash',
  'wave',
  'wavyDouble',
] as const;
const _check: readonly (typeof UNDERLINE_STYLES)[number][] = UNDERLINE_MENU;
void _check;

export function underlineItems(): MenuItemSpec[] {
  return [
    ...UNDERLINE_MENU.map((style) =>
      item(
        `underline.${style}`,
        t(`textHome.underline.${style}` as MessageKey),
        go('format.underlineStyle', { value: style }),
      ),
    ),
    item('underline.none', t('textHome.underline.none'), go('format.underlineStyle', { value: null }), {
      separatorBefore: true,
    }),
  ];
}

export function strikeItems(): MenuItemSpec[] {
  return [
    item('strike.single', t('textHome.strike.single'), go('format.strike', {})),
    item('strike.double', t('textHome.strike.double'), go('format.strikeDouble', {})),
  ];
}

export function effectItems(): MenuItemSpec[] {
  const effect = (name: 'outline' | 'shadow' | 'emboss' | 'engrave') =>
    item(`effect.${name}`, t(`textHome.effects.${name}`), go('format.effect', { value: name }));
  return [
    effect('outline'),
    effect('shadow'),
    effect('emboss'),
    effect('engrave'),
    item('effect.smallCaps', t('textHome.effects.smallCaps'), go('format.smallCaps', {}), { separatorBefore: true }),
    item('effect.allCaps', t('textHome.effects.allCaps'), go('format.allCaps', {})),
    item('effect.none', t('textHome.effects.none'), go('format.effect', { value: null }), { separatorBefore: true }),
  ];
}

export function caseItems(): MenuItemSpec[] {
  return CASE_MODES.map((mode) =>
    item(`case.${mode}`, t(`textHome.cases.${mode}`), go('format.changeCase', { value: mode })),
  );
}

export function bulletItems(): MenuItemSpec[] {
  return BULLET_LIBRARY.map((symbol) =>
    item(`bullet.${symbol}`, t('textHome.bullets.symbol', { symbol }), go('list.bullet', { value: symbol })),
  );
}

export function numberingItems(): MenuItemSpec[] {
  const looks = (Object.keys(NUMBER_LIBRARY) as (keyof typeof NUMBER_LIBRARY)[]).map((look) =>
    item(`number.${look}`, t(`textHome.numbering.${look}`), go('list.numberLook', { value: look })),
  );
  const multilevel = (Object.keys(MULTILEVEL_PRESETS) as (keyof typeof MULTILEVEL_PRESETS)[]).map((preset, at) =>
    item(`multilevel.${preset}`, t(`textHome.multilevel.${preset}`), go('list.multilevel', { value: preset }), {
      separatorBefore: at === 0,
    }),
  );
  return [...looks, ...multilevel];
}

export function multilevelItems(): MenuItemSpec[] {
  return (Object.keys(MULTILEVEL_PRESETS) as (keyof typeof MULTILEVEL_PRESETS)[]).map((preset) =>
    item(`multilevel.${preset}`, t(`textHome.multilevel.${preset}`), go('list.multilevel', { value: preset })),
  );
}

const SPACING: readonly [string, MessageKey, number][] = [
  ['single', 'textHome.spacing.single', 1],
  ['r115', 'textHome.spacing.r115', 1.15],
  ['r15', 'textHome.spacing.r15', 1.5],
  ['double', 'textHome.spacing.double', 2],
  ['r25', 'textHome.spacing.r25', 2.5],
  ['triple', 'textHome.spacing.triple', 3],
];

export function spacingItems(): MenuItemSpec[] {
  return [
    ...SPACING.map(([id, label, value]) => item(`spacing.${id}`, t(label), go('para.lineSpacing', { value }))),
    item(
      'spacing.addBefore',
      t('textHome.spacing.addBefore'),
      go('para.set', { key: 'before', attrs: { value: 12 } }),
      {
        separatorBefore: true,
      },
    ),
    item(
      'spacing.removeBefore',
      t('textHome.spacing.removeBefore'),
      go('para.set', { key: 'before', attrs: { value: null } }),
    ),
    item('spacing.addAfter', t('textHome.spacing.addAfter'), go('para.set', { key: 'after', attrs: { value: 8 } })),
    item(
      'spacing.removeAfter',
      t('textHome.spacing.removeAfter'),
      go('para.set', { key: 'after', attrs: { value: null } }),
    ),
  ];
}

export function shadeItems(scheme: Scheme): MenuItemSpec[] {
  const fills = ['honey', 'mint', 'rose', 'apricot', 'lilac'];
  return [
    ...fills.map((name) => {
      const hex = resolveColor(name, scheme) ?? 'transparent';
      // The palette name is stored, so the fill follows the theme and exports with the right color. The hex is the swatch.
      return item(
        `shade.${name}`,
        t(`textHome.shading.${name}` as MessageKey),
        go('para.set', { key: 'shade', attrs: { value: { fill: name } } }),
        {
          icon: swatchIcon(hex),
        },
      );
    }),
    item('shade.none', t('textHome.shading.none'), go('para.set', { key: 'shade', attrs: { value: null } }), {
      separatorBefore: true,
    }),
  ];
}

const SIDE = { style: 'single', width: 0.5, space: 1, color: null };

export function borderItems(): MenuItemSpec[] {
  const set = (id: string, label: MessageKey, border: object | null) =>
    item(`border.${id}`, t(label), go('para.set', { key: 'border', attrs: { value: border } }));
  return [
    set('bottom', 'textHome.borders.bottom', { bottom: SIDE }),
    set('top', 'textHome.borders.top', { top: SIDE }),
    set('box', 'textHome.borders.box', { top: SIDE, bottom: SIDE, start: SIDE, end: SIDE }),
    { ...set('none', 'textHome.borders.none', null), separatorBefore: true },
  ];
}

/** A small filled square as a menu icon: the swatch is data, so it takes the color it shows. */
export function swatchIcon(hex: string): IconComponent {
  const Swatch = () =>
    createElement('span', {
      'aria-hidden': true,
      'data-color-swatch': '',
      style: { display: 'inline-block', inlineSize: 16, blockSize: 16, borderRadius: 3, background: hex },
    });
  return Swatch as unknown as IconComponent;
}
