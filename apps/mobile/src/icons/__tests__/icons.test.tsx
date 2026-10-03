import { act, render, screen } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import type { ReactElement } from 'react';
import { ThemeProvider, useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { glassDark } from '../../theme/tokens';
import { ALIASES, GlassGlyph, GlassTile, GLYPH_NAMES, GLYPHS, glyphIcon, LUCIDE_TO_GLYPH, resolveGlyph, TAB_GLYPHS, TabGlyph, TILE_SIZES, type GlyphVariant, type TileSize } from '..';
import { splitShadow } from '../shadow';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// Glyphs and tiles are hidden from assistive tech, so queries must opt in.
const HIDDEN = { includeHiddenElements: true } as const;

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };

function walk(node: unknown, visit: (n: Node) => void) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  const n = node as Node;
  visit(n);
  n.children?.forEach((c) => walk(c, visit));
}

async function renderIn(scheme: ThemePreference, ui: ReactElement) {
  let set: ((p: ThemePreference) => void) | undefined;
  function Probe() {
    set = useTheme().setPreference;
    return null;
  }
  const r = await render(
    <ThemeProvider>
      <Probe />
      {ui}
    </ThemeProvider>,
  );
  await act(async () => set!(scheme));
  return r;
}

/** Every SVG id defined in the tree, and every id referenced through fill/stroke/mask/clip/filter. */
function svgRefs(tree: unknown) {
  const ids: string[] = [];
  const refs: string[] = [];
  let paths = 0;
  walk(tree, (n) => {
    if (n.type === 'RNSVGPath') paths++;
    if (typeof n.props.name === 'string') ids.push(n.props.name);
    for (const k of ['fill', 'stroke'] as const) {
      const brush = n.props[k] as { brushRef?: string } | null | undefined;
      if (brush?.brushRef) refs.push(brush.brushRef);
    }
    for (const k of ['mask', 'clipPath', 'filter'] as const) if (typeof n.props[k] === 'string') refs.push(n.props[k] as string);
  });
  return { ids, refs, paths };
}

describe('Lens glyphs', () => {
  /** Paths drawn under each element with a testID, from one walk of the tree. */
  function pathsByTestId(tree: unknown) {
    const out = new Map<string, number>();
    walk(tree, (n) => {
      if (typeof n.props.testID === 'string') out.set(n.props.testID, svgRefs(n).paths);
    });
    return out;
  }

  it.each(['face', 'lit', 'muted', 'rose', 'ink'] as GlyphVariant[])('every glyph renders as %s glass (dark)', async (v) => {
    const r = await renderIn('dark', <>{GLYPH_NAMES.map((n) => <GlassGlyph key={n} name={n} variant={v} testID={n} />)}</>);
    const paths = pathsByTestId(r.toJSON());
    for (const n of GLYPH_NAMES) expect(paths.get(n)).toBeGreaterThan(0);
  });

  it('ink (on the primary fill) is the pale step and the dark face only: no cast, sheen or bevel masks', async () => {
    const r = await renderIn('dark', <GlassGlyph name="record" variant="ink" testID="ink" />);
    const { ids, refs } = svgRefs(r.toJSON());
    expect(ids).toHaveLength(1); // the ink face gradient
    expect(refs.every((ref) => ref === ids[0])).toBe(true);
    // Two paths per part geometry (step + face): the ring tube and the core volume.
    expect(svgRefs(r.toJSON()).paths).toBe(4);
  });

  it('round-4 aliases resolve to the one source name', async () => {
    expect(ALIASES).toEqual({ ext: 'external', rocket: 'publish', arrow: 'forward', recIdle: 'recordIdle' });
    expect(resolveGlyph('rocket')).toBe('publish');
    expect(resolveGlyph('approve')).toBe('approve');
    await renderIn('light', <><GlassGlyph name="rocket" testID="a" /><GlassGlyph name="publish" testID="b" /></>);
    const paths = (id: string) => screen.getByTestId(id, HIDDEN).queryAll((n) => n.type === 'RNSVGPath').map((n) => n.props.d as string);
    expect(paths('a').length).toBeGreaterThan(0);
    expect(paths('a')).toEqual(paths('b'));
  });

  it('every glyph renders as a flat silhouette in light', async () => {
    const r = await renderIn('light', <>{GLYPH_NAMES.map((n) => <GlassGlyph key={n} name={n} testID={n} />)}</>);
    const paths = pathsByTestId(r.toJSON());
    for (const n of GLYPH_NAMES) expect(paths.get(n)).toBe(GLYPHS[n].reduce((k, p) => k + ('s' in p ? 1 : 0) + ('f' in p ? 1 : 0), 0));
    expect(svgRefs(r.toJSON()).ids).toEqual([]); // no gradients, masks or filters
  });

  it('keeps SVG ids unique per instance and every reference resolves', async () => {
    const r = await renderIn(
      'dark',
      <>
        <GlassGlyph name="record" />
        <GlassGlyph name="record" />
        <GlassGlyph name="remove" variant="rose" />
        <GlassTile name="approve" size="notice" tint="success" />
        <GlassTile name="approve" size="notice" tint="success" />
      </>,
    );
    const { ids, refs } = svgRefs(r.toJSON());
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ref of refs) expect(ids).toContain(ref);
  });

  it('maps every lucide-react-native icon the app imports to an existing glyph', () => {
    const root = path.resolve(__dirname, '../../..');
    const imported = new Set<string>();
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '__tests__') scan(p);
        } else if (/\.tsx?$/.test(entry.name)) {
          for (const m of fs.readFileSync(p, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react-native'/g)) {
            m[1]!
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s && !s.startsWith('type ') && s !== 'LucideIcon')
              .forEach((s) => imported.add(s));
          }
        }
      }
    };
    scan(path.join(root, 'app'));
    scan(path.join(root, 'src'));
    expect(imported.size).toBeGreaterThan(0);
    for (const name of imported) expect(LUCIDE_TO_GLYPH).toHaveProperty(name);
    for (const glyph of Object.values(LUCIDE_TO_GLYPH)) expect(GLYPHS).toHaveProperty(glyph);
    for (const tabs of Object.values(TAB_GLYPHS)) for (const glyph of Object.values(tabs)) expect(GLYPHS).toHaveProperty(glyph);
  });

  it('renders every mapped Lucide name through the Lucide-shaped component', async () => {
    const names = Object.keys(LUCIDE_TO_GLYPH) as (keyof typeof LUCIDE_TO_GLYPH)[];
    const r = await renderIn(
      'dark',
      <>
        {names.map((n) => {
          const Icon = glyphIcon(LUCIDE_TO_GLYPH[n]);
          return <Icon key={n} size={20} color="#fff" />;
        })}
      </>,
    );
    let svgs = 0;
    walk(r.toJSON(), (n) => {
      if (n.type === 'RNSVGSvgView') svgs++;
    });
    expect(svgs).toBe(names.length);
    expect(glyphIcon('send')).toBe(glyphIcon('send'));
  });

  it('renders every tile size, active and tinted, in both themes', async () => {
    const sizes = Object.keys(TILE_SIZES) as TileSize[];
    for (const scheme of ['dark', 'light'] as const) {
      const r = await renderIn(
        scheme,
        <>
          {sizes.map((s) => (
            <GlassTile key={s} name="discover" size={s} testID={`t-${s}`} />
          ))}
          {sizes.map((s) => (
            <GlassTile key={`a${s}`} name="discover" size={s} active testID={`ta-${s}`} />
          ))}
          <GlassTile name="alert" size="notice" tint="danger" variant="rose" />
          <TabGlyph name="work" focused />
        </>,
      );
      for (const s of sizes) {
        expect(r.getByTestId(`t-${s}`, HIDDEN)).toBeTruthy();
        expect(r.getByTestId(`ta-${s}`, HIDDEN)).toBeTruthy();
      }
    }
  });
});

describe('splitShadow', () => {
  it('keeps outset layers for boxShadow and turns hard insets into edges', () => {
    const { outer, insetEdges } = splitShadow(glassDark.glyphTile({ violet: true }).shadow);
    expect(outer).toBe('9px 13px 22px -9px rgba(2,1,10,0.95), 7px 10px 20px -8px rgba(111,155,255,0.5)');
    expect(insetEdges).toEqual([
      { dx: 1, dy: 1, color: 'rgba(235,240,255,0.18)' },
      { dx: -1, dy: -2, color: 'rgba(4,3,20,0.4)' },
    ]);
    expect(splitShadow(undefined)).toEqual({ outer: undefined, insetEdges: [] });
  });
});
