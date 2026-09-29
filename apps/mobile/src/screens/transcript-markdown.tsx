import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { Fragment, useMemo, useState } from "react";
import {
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  useWindowDimensions,
  View,
} from "react-native";
import { CopyTextButton } from "../components/copy-text-button";
import { SelectableTranscriptText } from "../components/selectable-transcript-text";
import { markdownPalette, palette, radius, space, typeRamp, typography } from "../theme";

// Parse Markdown only. HTML stays literal and images never make network requests.
const parserOptions = { html: false, linkify: true, maxNesting: 32 };
const parser = new MarkdownIt(parserOptions);
parser.linkify.set({ fuzzyLink: false, fuzzyEmail: false });

type Node = { token: Token; children: Node[]; key: string };
type Props = { style: StyleProp<TextStyle>; text: string; onOpenLink: (url: string) => void };

function nodes(tokens: Token[]): Node[] {
  const root: Node[] = [];
  const stack = [root];
  for (const [index, token] of tokens.entries()) {
    if (token.nesting === -1) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { token, children: [] as Node[], key: `${token.type}:${index}` };
    stack[stack.length - 1]?.push(node);
    if (token.nesting === 1) stack.push(node.children);
  }
  return root;
}

function safeLink(href: string | null) {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function InlineContent({
  tokens,
  onOpenLink,
}: {
  tokens: Token[];
  onOpenLink: Props["onOpenLink"];
}) {
  let bold = 0;
  let italic = 0;
  let strike = 0;
  let href: string | undefined;
  let ordinal = 0;
  return tokens.map((token) => {
    const key = `${token.type}:${ordinal++}`;
    if (token.type === "strong_open") {
      bold++;
      return null;
    }
    if (token.type === "strong_close") {
      bold--;
      return null;
    }
    if (token.type === "em_open") {
      italic++;
      return null;
    }
    if (token.type === "em_close") {
      italic--;
      return null;
    }
    if (token.type === "s_open") {
      strike++;
      return null;
    }
    if (token.type === "s_close") {
      strike--;
      return null;
    }
    if (token.type === "link_open") {
      href = safeLink(token.attrGet("href"));
      return null;
    }
    if (token.type === "link_close") {
      href = undefined;
      return null;
    }
    const code = token.type === "code_inline";
    const link = code ? undefined : href;
    const content =
      token.type === "softbreak" ? " " : token.type === "hardbreak" ? "\n" : token.content;
    if (!content) return null;
    return (
      <Text
        key={key}
        {...(link ? { accessibilityRole: "link" as const, onPress: () => onOpenLink(link) } : {})}
        style={[
          bold > 0 && styles.bold,
          italic > 0 && styles.italic,
          strike > 0 && styles.strike,
          code && styles.inlineCode,
          link && styles.link,
        ]}
      >
        {content}
      </Text>
    );
  });
}

export function InlineTranscriptMarkdown({
  prefix,
  prefixStyle,
  ...props
}: Props & {
  prefix?: string | undefined;
  prefixStyle?: StyleProp<TextStyle>;
}) {
  const tokens = useMemo(
    () => parser.parseInline(props.text, {}).flatMap((token) => token.children ?? []),
    [props.text],
  );
  return (
    <SelectableTranscriptText dynamicTypeRamp={typeRamp.body} style={props.style}>
      {prefix ? <Text style={prefixStyle}>{`${prefix}  `}</Text> : null}
      {InlineContent({ tokens, onOpenLink: props.onOpenLink })}
    </SelectableTranscriptText>
  );
}

export function TranscriptMarkdown({ text, ...props }: Props) {
  const blocks = useMemo(() => nodes(parser.parse(text, {})), [text]);
  return (
    <View style={styles.blocks}>
      <Blocks blocks={blocks} {...props} />
    </View>
  );
}

function Blocks({ blocks, ...props }: Omit<Props, "text"> & { blocks: Node[] }) {
  return blocks.map(({ token, children, key }) => {
    switch (token.type) {
      case "inline":
        return (
          <Fragment key={key}>
            {InlineContent({ tokens: token.children ?? [], onOpenLink: props.onOpenLink })}
          </Fragment>
        );
      case "paragraph_open":
      case "heading_open":
        return (
          <SelectableTranscriptText
            key={key}
            accessibilityRole={token.type === "heading_open" ? "header" : undefined}
            dynamicTypeRamp={token.type === "heading_open" ? typeRamp.subheading : typeRamp.body}
            selectable
            style={[
              props.style,
              token.type === "heading_open" && styles.heading,
              token.tag === "h1" && styles.heading1,
              token.tag === "h2" && styles.heading2,
              /h[4-6]/.test(token.tag) && styles.headingSmall,
            ]}
          >
            {Blocks({ blocks: children, ...props })}
          </SelectableTranscriptText>
        );
      case "fence":
      case "code_block": {
        const language = token.info.trim().split(/\s+/)[0]?.slice(0, 32);
        return (
          <View
            key={key}
            accessibilityLabel={language ? `Code block, ${language}` : "Code block"}
            style={styles.codeBlock}
          >
            <View style={styles.codeHeader}>
              {language ? (
                <Text dynamicTypeRamp={typeRamp.caption} style={styles.codeLanguage}>
                  {language.toLocaleUpperCase()}
                </Text>
              ) : null}
              <CopyTextButton text={token.content} label="Copy code" />
            </View>
            <ScrollView horizontal>
              <SelectableTranscriptText
                unwrapped
                dynamicTypeRamp={typeRamp.body}
                style={styles.codeText}
              >
                {token.content.replace(/\n$/, "")}
              </SelectableTranscriptText>
            </ScrollView>
          </View>
        );
      }
      case "table_open":
        return <MarkdownTable key={key} sections={children} {...props} />;
      case "bullet_list_open":
      case "ordered_list_open":
        return (
          <View key={key} style={styles.list}>
            {children.map((item, index) => (
              <View key={item.key} style={styles.listRow}>
                <Text style={[props.style, styles.marker]}>
                  {token.type === "ordered_list_open"
                    ? `${Number(token.attrGet("start") ?? 1) + index}.`
                    : "•"}
                </Text>
                <View style={styles.listBody}>
                  <Blocks blocks={item.children} {...props} />
                </View>
              </View>
            ))}
          </View>
        );
      case "blockquote_open":
        return (
          <View key={key} style={styles.quote}>
            <Blocks blocks={children} {...props} />
          </View>
        );
      case "hr":
        return <View key={key} style={styles.rule} />;
      default:
        return (
          <SelectableTranscriptText key={key} style={props.style}>
            {token.content}
          </SelectableTranscriptText>
        );
    }
  });
}

function MarkdownTable({ sections, ...props }: Omit<Props, "text"> & { sections: Node[] }) {
  const { width, fontScale } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number>();
  const rows = sections.flatMap((section) => section.children);
  const columns = rows[0]?.children.length ?? 1;
  const availableWidth = measuredWidth ?? width - space.lg * 2;
  const columnWidth = Math.max(availableWidth / columns, 140 * fontScale);
  return (
    <View onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}>
      <ScrollView horizontal accessibilityLabel="Markdown table" showsHorizontalScrollIndicator>
        <View style={{ width: columnWidth * columns }}>
          {rows.map((row) => (
            <View key={row.key} style={styles.tableRow}>
              {row.children.map((cell) => (
                <View key={cell.key} style={[styles.tableCell, { width: columnWidth }]}>
                  <SelectableTranscriptText
                    accessibilityRole={cell.token.type === "th_open" ? "header" : undefined}
                    dynamicTypeRamp={typeRamp.body}
                    selectable
                    style={[
                      props.style,
                      cell.token.type === "th_open" && styles.tableHeading,
                      cell.token.attrGet("style") === "text-align:right" && styles.alignRight,
                      cell.token.attrGet("style") === "text-align:center" && styles.alignCenter,
                    ]}
                  >
                    {Blocks({ blocks: cell.children, ...props })}
                  </SelectableTranscriptText>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: space.md },
  bold: { color: markdownPalette.strong, fontWeight: "700" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  inlineCode: {
    fontFamily: typography.code.fontFamily,
    color: palette.ink,
    backgroundColor: palette.raised,
  },
  link: { color: markdownPalette.linkText, textDecorationLine: "underline" },
  heading: { fontWeight: "600", fontSize: 18, lineHeight: 26, marginTop: space.sm },
  heading1: { fontSize: 22, lineHeight: 30 },
  heading2: { fontSize: 20, lineHeight: 28 },
  headingSmall: { fontSize: 16, lineHeight: 24 },
  codeBlock: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 12,
    gap: space.xs,
  },
  codeLanguage: { ...typography.label, color: palette.dim },
  codeHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
  },
  codeText: { ...typography.code, color: palette.ink },
  list: { gap: space.sm },
  listRow: { flexDirection: "row", gap: space.sm },
  marker: { minWidth: 20 },
  listBody: { flex: 1, minWidth: 0, gap: space.sm },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: palette.border,
    paddingLeft: space.md,
    gap: space.sm,
  },
  rule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  tableCell: { paddingHorizontal: 12, paddingVertical: space.md },
  tableHeading: { fontWeight: "600" },
  alignRight: { textAlign: "right" },
  alignCenter: { textAlign: "center" },
});
