import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic } from "@/lib/haptics";

export type Tab = "Shows" | "Movies" | "Anime" | "New & Hot";

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  hasUnread?: boolean;
  scrollY?: Animated.Value;
}

const TABS: Tab[] = ["Shows", "Movies", "Anime", "New & Hot"];

const _fallbackScroll = new Animated.Value(0);

export default function Header({ activeTab, onTabChange, hasUnread = false, scrollY }: Props) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? Math.max(insets.top, 12) : insets.top;

  const activeScroll = scrollY ?? _fallbackScroll;
  const headerBg = activeScroll.interpolate({
    inputRange: [0, 60],
    outputRange: ["rgba(0,0,0,0)", "rgba(15,15,15,0.92)"],
    extrapolate: "clamp",
  });

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: headerBg, borderWidth: 0, outlineWidth: 0 },
          Platform.OS === "web" && styles.scrollBgWebTransition,
        ]}
        pointerEvents="none"
      />

      {/* Row 1: Logo + Brand + Icons */}
      <View style={styles.brandRow}>
        <View style={styles.brandLeft}>
          <Image
            source={require("@/assets/images/header-logo-new.png")}
            style={styles.logo}
          />
          <View style={styles.brandTextBlock}>
            <Text style={styles.brandMain}>MOVIE</Text>
            <View style={styles.originalBadge}>
              <Text style={styles.brandSub}>ORIGINAL</Text>
            </View>
          </View>
        </View>

        <View style={styles.iconsRow}>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.55 }]}
            hitSlop={10}
            accessibilityLabel="Downloads"
          >
            <Feather name="download" size={22} color="#e5e5e5" />
          </Pressable>

          <Pressable
            onPress={() => { haptic.light(); router.push("/notifications"); }}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.55 }]}
            hitSlop={10}
            accessibilityLabel="Notifications"
          >
            <Feather name="bell" size={22} color="#e5e5e5" />
            {hasUnread && <View style={styles.badge} />}
          </Pressable>

        </View>
      </View>

      {/* Row 2: Tab chips */}
      <View style={styles.pillsWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsRow}
          style={styles.pillsScroll}
        >
          {TABS.map((t) => (
            <Pressable
              key={t}
              onPress={() => { haptic.selection(); onTabChange(t); }}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              hitSlop={8}
            >
              <View style={[styles.pill, activeTab === t && styles.pillActive]}>
                <Text style={[styles.pillText, activeTab === t && styles.pillTextActive]}>
                  {t}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: "transparent",
    paddingBottom: 0,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 6,
  },
  brandLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 0,
    marginRight: 10,
    resizeMode: "contain",
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  brandTextBlock: {
    flexDirection: "column",
    gap: 1,
    justifyContent: "center",
  },
  brandMain: {
    color: "#FFFFFF",
    fontSize: 16,
    fontFamily: "Inter_300Light",
    fontWeight: "300",
    letterSpacing: 4,
    lineHeight: 20,
    textTransform: "uppercase",
  },
  originalBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#E50914",
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  brandSub: {
    color: "#FFFFFF",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    letterSpacing: 2,
    lineHeight: 12,
    textTransform: "uppercase",
  },
  categoryLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    letterSpacing: 1.5,
    marginTop: 3,
    textTransform: "uppercase",
  },
  iconsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  iconBtn: {
    padding: 2,
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#E50914",
    borderWidth: 1.5,
    borderColor: "#000000",
  },
  scrollBgWebTransition: {
    transition: "background-color 0.3s ease",
  } as any,
  pillsWrapper: {
    marginTop: 10,
    paddingBottom: 12,
    backgroundColor: "transparent",
    borderBottomWidth: 0,
    borderBottomColor: "transparent",
    borderWidth: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
    outlineWidth: 0,
  },
  pillsScroll: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderBottomWidth: 0,
    borderBottomColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
    outlineWidth: 0,
  },
  pillsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingRight: 24,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 0,
  },
  pillActive: {
    backgroundColor: "#FFFFFF",
    borderWidth: 0,
  },
  pillText: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  pillTextActive: {
    color: "#000000",
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
});
