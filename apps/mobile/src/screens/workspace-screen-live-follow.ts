import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  recordTranscriptFollowCorrection,
  recordTranscriptLatestJump,
} from "../state/transcript-performance";
import type { TranscriptListItem } from "./session-transcript";
import {
  resolveTranscriptLiveFollow,
  type TranscriptLiveFollowEvent,
} from "./session-transcript-live-follow";

const liveEdgeThreshold = 2;
const userScrollSettleMs = 160;

export type TranscriptLiveFollow = ReturnType<typeof useTranscriptLiveFollow>;

export function useTranscriptLiveFollow() {
  const [liveFollowEnabled, setLiveFollowEnabled] = useState(true);
  const [latestJumpPending, setLatestJumpPending] = useState(false);
  const transcriptListRef = useRef<FlatList<TranscriptListItem>>(null);
  const liveFollowEnabledRef = useRef(true);
  const latestJumpPendingRef = useRef(false);
  const userScrollSessionRef = useRef(false);
  const userScrollSettleTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const followFrameRef = useRef<number>(null);
  const lastScrollOffsetRef = useRef(0);

  const clearUserScrollSettle = useCallback(() => {
    if (userScrollSettleTimerRef.current === null) return;
    clearTimeout(userScrollSettleTimerRef.current);
    userScrollSettleTimerRef.current = null;
  }, []);

  const cancelFollowFrame = useCallback(() => {
    if (followFrameRef.current === null) return;
    cancelAnimationFrame(followFrameRef.current);
    followFrameRef.current = null;
  }, []);

  const reset = useCallback(() => {
    clearUserScrollSettle();
    cancelFollowFrame();
    userScrollSessionRef.current = false;
    lastScrollOffsetRef.current = 0;
    liveFollowEnabledRef.current = true;
    latestJumpPendingRef.current = false;
    setLiveFollowEnabled(true);
    setLatestJumpPending(false);
  }, [cancelFollowFrame, clearUserScrollSettle]);

  function transitionLiveFollow(event: TranscriptLiveFollowEvent) {
    const next = resolveTranscriptLiveFollow(liveFollowEnabledRef.current, event);
    if (next === liveFollowEnabledRef.current) return;
    liveFollowEnabledRef.current = next;
    setLiveFollowEnabled(next);
  }

  function isAtLiveEdge(offset: number) {
    return offset <= liveEdgeThreshold;
  }

  function recordTranscriptOffset(rawOffset: number) {
    const offset = Math.max(0, rawOffset);
    lastScrollOffsetRef.current = offset;
    if (latestJumpPendingRef.current && isAtLiveEdge(offset)) {
      latestJumpPendingRef.current = false;
      setLatestJumpPending(false);
    }
    return offset;
  }

  function scheduleLiveEdgeScroll(itemCount: number) {
    if (!liveFollowEnabledRef.current || itemCount === 0 || followFrameRef.current !== null) {
      return;
    }
    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = null;
      if (!liveFollowEnabledRef.current) return;
      recordTranscriptFollowCorrection();
      transcriptListRef.current?.scrollToOffset({ animated: false, offset: 0 });
    });
  }

  function handleTranscriptScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const offset = recordTranscriptOffset(event.nativeEvent.contentOffset.y);
    const atLiveEdge = isAtLiveEdge(offset);
    transitionLiveFollow({
      isAtLiveEdge: atLiveEdge,
      type: "scroll",
      userScrollSessionActive: userScrollSessionRef.current,
    });
  }

  function handleScrollBeginDrag() {
    clearUserScrollSettle();
    if (latestJumpPendingRef.current) {
      latestJumpPendingRef.current = false;
      setLatestJumpPending(false);
    }
    userScrollSessionRef.current = true;
    transitionLiveFollow({ type: "user-scroll-begin" });
  }

  function finishUserScroll(releaseIsAtLiveEdge: boolean) {
    clearUserScrollSettle();
    const userScrollSessionActive = userScrollSessionRef.current;
    userScrollSessionRef.current = false;
    transitionLiveFollow({
      isAtLiveEdge: releaseIsAtLiveEdge,
      type: "user-scroll-end",
      userScrollSessionActive,
    });
  }

  function handleScrollEndDrag(event: NativeSyntheticEvent<NativeScrollEvent>) {
    clearUserScrollSettle();
    const offset = recordTranscriptOffset(event.nativeEvent.contentOffset.y);
    const releaseIsAtLiveEdge = isAtLiveEdge(offset);
    userScrollSettleTimerRef.current = setTimeout(
      () => finishUserScroll(releaseIsAtLiveEdge),
      userScrollSettleMs,
    );
  }

  function handleMomentumScrollBegin() {
    if (userScrollSessionRef.current) clearUserScrollSettle();
  }

  function handleMomentumScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    recordTranscriptOffset(event.nativeEvent.contentOffset.y);
    finishUserScroll(isAtLiveEdge(lastScrollOffsetRef.current));
  }

  function scrollToLatest() {
    clearUserScrollSettle();
    cancelFollowFrame();
    userScrollSessionRef.current = false;
    latestJumpPendingRef.current = true;
    setLatestJumpPending(true);
    recordTranscriptLatestJump();
    transitionLiveFollow({ type: "reset" });
    transcriptListRef.current?.scrollToOffset({ animated: true, offset: 0 });
    void Haptics.selectionAsync().catch(() => undefined);
  }

  return {
    cancelFollowFrame,
    clearUserScrollSettle,
    handleMomentumScrollBegin,
    handleMomentumScrollEnd,
    handleScrollBeginDrag,
    handleScrollEndDrag,
    handleTranscriptScroll,
    latestJumpPending,
    liveFollowEnabled,
    reset,
    scheduleLiveEdgeScroll,
    scrollToLatest,
    transcriptListRef,
  };
}

export function useTranscriptLiveFollowReset(scope: string, follow: TranscriptLiveFollow) {
  const { cancelFollowFrame, clearUserScrollSettle, reset } = follow;
  useEffect(() => {
    void scope;
    reset();
    return () => {
      clearUserScrollSettle();
      cancelFollowFrame();
    };
  }, [cancelFollowFrame, clearUserScrollSettle, reset, scope]);
}
