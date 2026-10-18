import { HStack, Image, Rectangle, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, frame, lineLimit, offset, padding, rotationEffect, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget } from "expo-widgets";
import type { ChartWidgetProps, RecentWidgetProps } from "./widgetData";

const ChartView = (props: ChartWidgetProps) => {
  "widget";
  return (
    <VStack alignment="leading" spacing={5} modifiers={[padding({ all: 12 }), containerBackground("#F7FAF7", "widget"), widgetURL("penny:///")]}>
      <Text modifiers={[font({ size: 10, weight: "semibold" }), foregroundStyle("#68766D")]}>THIS {props.month}</Text>
      <Text modifiers={[font({ size: 19, weight: "bold" }), foregroundStyle("#1D3A2C"), lineLimit(1)]}>{props.balance}</Text>
      {props.hasEntries ? (
        <ZStack modifiers={[frame({ width: 112, height: 44 })]}>
          {props.income.map((segment, index) => (
            <Rectangle key={`income-${index}`} modifiers={[frame({ width: segment.width, height: 2 }), foregroundStyle("#528768"), rotationEffect(segment.angle), offset({ x: segment.x, y: segment.y })]} />
          ))}
          {props.expenses.map((segment, index) => (
            <Rectangle key={`expense-${index}`} modifiers={[frame({ width: segment.width, height: 2 }), foregroundStyle("#E47850"), rotationEffect(segment.angle), offset({ x: segment.x, y: segment.y })]} />
          ))}
        </ZStack>
      ) : <Text modifiers={[font({ size: 10 }), foregroundStyle("#68766D"), frame({ height: 44 })]}>No income or spending</Text>}
      <HStack spacing={8}>
        <Text modifiers={[font({ size: 9, weight: "medium" }), foregroundStyle("#528768")]}>● Income</Text>
        <Text modifiers={[font({ size: 9, weight: "medium" }), foregroundStyle("#E47850")]}>● Spent</Text>
      </HStack>
    </VStack>
  );
};

const RecentView = (props: RecentWidgetProps) => {
  "widget";
  return (
    <VStack alignment="leading" spacing={7} modifiers={[padding({ all: 12 }), containerBackground("#F7FAF7", "widget"), widgetURL("penny://entries/new")]}>
      <HStack>
        <Text modifiers={[font({ size: 12, weight: "bold" }), foregroundStyle("#1D3A2C")]}>Expenses</Text>
        <Spacer />
        <Image systemName="plus.circle.fill" size={22} color="#E47850" />
      </HStack>
      {props.expenses.length ? props.expenses.map((expense) => (
        <HStack key={expense.id} spacing={3} modifiers={[frame({ maxWidth: 128 })]}>
          <Text modifiers={[font({ size: 10, weight: "medium" }), foregroundStyle("#1D3A2C"), lineLimit(1), frame({ maxWidth: 72, alignment: "leading" })]}>{expense.title}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 10, weight: "semibold" }), foregroundStyle("#1D3A2C"), lineLimit(1)]}>{expense.amount}</Text>
        </HStack>
      )) : <Text modifiers={[font({ size: 10 }), foregroundStyle("#68766D")]}>No expenses yet</Text>}
    </VStack>
  );
};

export const BalanceChartWidget = createWidget("BalanceChartWidget", ChartView);
export const RecentExpensesWidget = createWidget("RecentExpensesWidget", RecentView);

export function clearWidgetSnapshots() {
  BalanceChartWidget.updateSnapshot({ month: "", balance: "Sign in to Penny", income: [], expenses: [], hasEntries: false });
  RecentExpensesWidget.updateSnapshot({ expenses: [] });
}
