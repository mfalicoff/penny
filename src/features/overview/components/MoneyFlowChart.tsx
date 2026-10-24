import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import type { Category, Transaction } from "../../../domain/ledger";
import { C, Icon, s } from "../../../shared/ui";
import {
  buildMoneyFlow,
  layoutMoneyFlow,
  type PositionedFlowNode,
} from "../moneyFlow";

function ribbon(
  x: number,
  y: number,
  endX: number,
  endY: number,
  height: number,
) {
  const bend = (x + endX) / 2;
  return `M ${x} ${y} C ${bend} ${y}, ${bend} ${endY}, ${endX} ${endY} L ${endX} ${endY + height} C ${bend} ${endY + height}, ${bend} ${y + height}, ${x} ${y + height} Z`;
}

export function MoneyFlowChart({
  entries,
  categories,
  currency,
  monthLabel,
}: {
  entries: Transaction[];
  categories: Category[];
  currency: string;
  monthLabel: string;
}) {
  const flow = useMemo(
    () => buildMoneyFlow(entries, categories),
    [entries, categories],
  );
  const layout = useMemo(() => layoutMoneyFlow(flow), [flow]);
  const [availableWidth, setAvailableWidth] = useState(640);
  const [selected, setSelected] = useState<string | null>(null);
  const width = Math.max(640, availableWidth);
  const leftX = 146;
  const middleX = width / 2 - 5;
  const rightX = width - 156;
  const money = (amount: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
      amount / 100,
    );
  const active = [...flow.sources, ...flow.destinations].find(
    (node) => node.id === selected,
  );
  const opacity = (id: string) =>
    !active ? 0.32 : active.id === id ? 0.68 : 0.08;
  const label = (node: PositionedFlowNode, side: "left" | "right") => (
    <Pressable
      key={node.id}
      accessibilityRole="button"
      accessibilityLabel={`${node.label}, ${money(node.amount)}, ${Math.round((node.amount / flow.total) * 100)} percent of monthly flow`}
      accessibilityState={{ selected: active?.id === node.id }}
      onPress={() => setSelected(selected === node.id ? null : node.id)}
      style={({ pressed }) => ({
        position: "absolute",
        left: side === "left" ? 0 : rightX + 16,
        width: 136,
        top: node.y + node.height / 2 - 24,
        minHeight: 48,
        paddingHorizontal: 6,
        justifyContent: "center",
        gap: 4,
        borderRadius: 8,
        backgroundColor:
          active?.id === node.id ? `${node.color}16` : "transparent",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        numberOfLines={2}
        style={{
          fontSize: 11,
          color: C.ink,
          fontWeight: "500",
          textAlign: side === "left" ? "right" : "left",
        }}
      >
        {node.label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{
          fontSize: 12,
          color: node.color,
          fontWeight: "600",
          textAlign: side === "left" ? "right" : "left",
        }}
      >
        {money(node.amount)}
      </Text>
    </Pressable>
  );

  return (
    <View style={[s.card, { gap: 18 }]}>
      <View style={s.between}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={s.heading}>Follow your money</Text>
          <Text style={s.muted}>
            {monthLabel} · From coming in to going out.
          </Text>
        </View>
        <Icon name="git-branch-outline" color={C.green} />
      </View>
      {!flow.total ? (
        <View style={{ alignItems: "center", paddingVertical: 30, gap: 10 }}>
          <Icon name="git-branch-outline" size={30} color={C.green} />
          <Text style={{ color: C.ink, fontSize: 14 }}>
            Every little entry tells a story.
          </Text>
          <Text style={[s.muted, { textAlign: "center" }]}>
            Add income, expenses, or investments this month to see your money flow.
          </Text>
        </View>
      ) : (
        <>
          <View
            onLayout={(event) =>
              setAvailableWidth(event.nativeEvent.layout.width)
            }
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={width > availableWidth}
              contentContainerStyle={{ width }}
            >
              <View style={{ width }}>
                <View style={{ height: 55 }}>
                  <Text
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 5,
                      width: 140,
                      fontSize: 9,
                      letterSpacing: 1,
                      color: C.muted,
                    }}
                  >
                    {flow.gap ? "INCOME + GAP" : "INCOME SOURCES"}
                  </Text>
                  <View
                    style={{
                      position: "absolute",
                      left: middleX - 72,
                      width: 154,
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Text
                      style={{ fontSize: 9, letterSpacing: 1, color: C.muted }}
                    >
                      MONTHLY FLOW
                    </Text>
                    <Text
                      style={{ fontSize: 17, color: C.ink, fontWeight: "600" }}
                    >
                      {money(flow.total)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 5,
                      width: 145,
                      fontSize: 9,
                      letterSpacing: 1,
                      color: C.muted,
                    }}
                  >
                    WHERE IT GOES
                  </Text>
                </View>
                <View style={{ height: layout.height, width }}>
                  <Svg
                    width={width}
                    height={layout.height}
                    {...(Platform.OS === "web"
                      ? { "aria-hidden": true, tabIndex: -1 as const }
                      : { accessible: false })}
                    style={{ pointerEvents: "none" }}
                  >
                    {layout.sources.map((node) => (
                      <Path
                        key={node.id}
                        d={ribbon(
                          leftX + 8,
                          node.y,
                          middleX,
                          node.middleY,
                          node.height,
                        )}
                        fill={node.color}
                        opacity={opacity(node.id)}
                      />
                    ))}
                    {layout.destinations.map((node) => (
                      <Path
                        key={node.id}
                        d={ribbon(
                          middleX + 10,
                          node.middleY,
                          rightX,
                          node.y,
                          node.height,
                        )}
                        fill={node.color}
                        opacity={opacity(node.id)}
                      />
                    ))}
                    <Rect
                      x={middleX}
                      y={layout.middleY}
                      width={10}
                      height={layout.bandHeight}
                      rx={3}
                      fill={C.ink}
                      opacity={0.85}
                    />
                    {layout.sources.map((node) => (
                      <Rect
                        key={node.id}
                        x={leftX}
                        y={node.y}
                        width={8}
                        height={node.height}
                        rx={Math.min(3, node.height / 2)}
                        fill={node.color}
                      />
                    ))}
                    {layout.destinations.map((node) => (
                      <Rect
                        key={node.id}
                        x={rightX}
                        y={node.y}
                        width={8}
                        height={node.height}
                        rx={Math.min(3, node.height / 2)}
                        fill={node.color}
                      />
                    ))}
                  </Svg>
                  {layout.sources.map((node) => label(node, "left"))}
                  {layout.destinations.map((node) => label(node, "right"))}
                </View>
              </View>
            </ScrollView>
          </View>
          {width > availableWidth + 1 && (
            <Text style={{ fontSize: 11, color: C.muted }}>
              Swipe across to follow the full flow →
            </Text>
          )}
          <View
            style={{
              backgroundColor: C.bg,
              borderRadius: 10,
              padding: 12,
              gap: 5,
            }}
          >
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: active ? C.ink : C.muted,
                fontSize: 12,
                lineHeight: 19,
              }}
            >
              {active
                ? `${active.label} · ${money(active.amount)} · ${((active.amount / flow.total) * 100).toFixed(1)}% of monthly flow`
                : "Wider bands mean larger amounts. Tap a label to highlight its flow."}
            </Text>
            <Text style={{ color: C.muted, fontSize: 11, lineHeight: 18 }}>
              {flow.gap
                ? `Expenses and investments exceed the income shown by ${money(flow.gap)}. “Beyond income” balances the diagram; its funding source is not recorded.`
                : "Expenses include only your share of split receipts. Invested shows contributions. Left over is income minus expenses and investments, not an account balance."}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
