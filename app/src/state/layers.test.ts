// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeAllLayers,
  hasModalLayer,
  hasOpenLayer,
  installLayerEscape,
  interceptEscape,
  layerStore,
  pushLayer,
  topLayer,
} from './layers';
import type { Layer } from './layers';

const layer = (id: string, modal = false): Layer => ({ id, kind: modal ? 'dialog' : 'menu', modal, close: vi.fn() });
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

afterEach(() => layerStore.set([]));

describe('the layer stack', () => {
  it('keeps layers in order and pops the one it pushed', () => {
    const dialog = layer('dialog', true);
    const menu = layer('menu');
    const popDialog = pushLayer(dialog);
    pushLayer(menu);
    expect(topLayer()).toBe(menu);
    expect(hasOpenLayer()).toBe(true);
    expect(hasModalLayer()).toBe(true);
    popDialog();
    expect(layerStore.get()).toEqual([menu]);
    expect(hasModalLayer()).toBe(false);
  });

  it('moves a layer pushed again to the top', () => {
    const first = layer('a');
    pushLayer(first);
    pushLayer(layer('b'));
    pushLayer(first);
    expect(topLayer()).toBe(first);
    expect(layerStore.get()).toHaveLength(2);
  });

  it('closes every layer, top first', () => {
    const order: string[] = [];
    pushLayer({ ...layer('a'), close: () => order.push('a') });
    pushLayer({ ...layer('b'), close: () => order.push('b') });
    closeAllLayers();
    expect(order).toEqual(['b', 'a']);
  });
});

describe('Escape', () => {
  it('closes only the top layer, and says so by cancelling the event', () => {
    const stop = installLayerEscape();
    const [below, top] = [layer('below', true), layer('top')];
    pushLayer(below);
    pushLayer(top);
    expect(escape()).toBe(false);
    expect(top.close).toHaveBeenCalledWith('escape');
    expect(below.close).not.toHaveBeenCalled();
    stop();
  });

  it('does nothing without layers', () => {
    const stop = installLayerEscape();
    expect(escape()).toBe(true);
    stop();
  });

  it('lets an interceptor, such as a showing tooltip, take Escape first', () => {
    const stop = installLayerEscape();
    const top = layer('top');
    pushLayer(top);
    let showing = true;
    const remove = interceptEscape(() => {
      const used = showing;
      showing = false;
      return used;
    });
    expect(escape()).toBe(false);
    expect(top.close).not.toHaveBeenCalled();
    escape();
    expect(top.close).toHaveBeenCalledTimes(1);
    remove();
    stop();
  });
});
