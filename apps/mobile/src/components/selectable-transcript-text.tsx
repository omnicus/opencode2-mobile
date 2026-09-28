import { requireNativeView, requireOptionalNativeModule } from "expo";
import { Children, isValidElement, type ReactNode, useMemo, useState } from "react";
import {
  Platform,
  processColor,
  StyleSheet,
  Text,
  type TextProps,
  type TextStyle,
  useWindowDimensions,
  type ViewProps,
} from "react-native";

type Run = {
  text: string;
  color: number;
  background?: number;
  fontSize: number;
  lineHeight: number;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  strike: boolean;
  underline: boolean;
  link: boolean;
  alignment: string;
};
type NativeProps = ViewProps & {
  runs: Run[];
  unwrapped: boolean;
  onMeasure: (event: { nativeEvent: { width: number; height: number } }) => void;
  onLink: (event: { nativeEvent: { index: number } }) => void;
};
// Older installed builds and Expo Go retain the standard renderer until rebuilt.
const NativeText =
  Platform.OS === "ios" && requireOptionalNativeModule("TranscriptSelection")
    ? requireNativeView<NativeProps>("TranscriptSelection")
    : undefined;

export function selectionRuns(children: ReactNode, base: TextStyle, scale: number) {
  const runs: Run[] = [];
  const actions: Array<(() => void) | undefined> = [];
  function visit(content: ReactNode, style: TextStyle, action?: () => void) {
    Children.forEach(content, (child) => {
      if (typeof child === "string" || typeof child === "number") {
        const fontSize = Number(style.fontSize ?? 17) * scale;
        const color = processColor(style.color ?? "#ffffff");
        const background = processColor(style.backgroundColor);
        runs.push({
          text: String(child),
          color: typeof color === "number" ? color : 0xffffffff,
          ...(typeof background === "number" ? { background } : {}),
          fontSize,
          lineHeight: Number(style.lineHeight ?? Number(style.fontSize ?? 17) * 1.5) * scale,
          bold: style.fontWeight === "bold" || Number(style.fontWeight) >= 600,
          italic: style.fontStyle === "italic",
          mono: /menlo|monospace|courier/i.test(style.fontFamily ?? ""),
          strike: style.textDecorationLine?.includes("line-through") ?? false,
          underline: style.textDecorationLine?.includes("underline") ?? false,
          link: Boolean(action),
          alignment: style.textAlign ?? "left",
        });
        actions.push(action);
      } else if (
        isValidElement<{ children?: ReactNode; style?: TextProps["style"]; onPress?: () => void }>(
          child,
        )
      ) {
        visit(
          child.props.children,
          { ...style, ...StyleSheet.flatten(child.props.style) },
          child.props.onPress ?? action,
        );
      }
    });
  }
  visit(children, base);
  return { runs, actions };
}

export function SelectableTranscriptText({
  children,
  style,
  unwrapped = false,
  ...props
}: TextProps & { unwrapped?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const flatStyle = StyleSheet.flatten(style) ?? {};
  const { runs, actions } = useMemo(
    () =>
      selectionRuns(
        children,
        StyleSheet.flatten(style) ?? {},
        props.allowFontScaling === false ? 1 : fontScale,
      ),
    [children, style, fontScale, props.allowFontScaling],
  );
  if (Platform.OS !== "ios" || !NativeText)
    return (
      <Text {...props} selectable style={style}>
        {children}
      </Text>
    );
  return (
    <NativeText
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole={props.accessibilityRole}
      runs={runs}
      unwrapped={unwrapped}
      onMeasure={({ nativeEvent }) => {
        if (
          Number.isFinite(nativeEvent.height) &&
          nativeEvent.height >= 0 &&
          Number.isFinite(nativeEvent.width)
        ) {
          setSize((current) =>
            current?.width === nativeEvent.width && current.height === nativeEvent.height
              ? current
              : nativeEvent,
          );
        }
      }}
      onLink={({ nativeEvent }) => actions[nativeEvent.index]?.()}
      style={{
        ...flatStyle,
        height: size?.height ?? Number(flatStyle.lineHeight ?? 26) * fontScale,
        ...(unwrapped ? { width: size?.width ?? 1 } : {}),
      }}
    />
  );
}
