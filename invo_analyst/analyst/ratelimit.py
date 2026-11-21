"""Sliding-window rate limiter: at most max_calls in any window_s seconds."""

from __future__ import annotations

import collections
import time


class SlidingWindowLimiter:
    def __init__(self, max_calls: int, window_s: float, clock=time.monotonic, sleep=time.sleep):
        if max_calls <= 0 or window_s <= 0:
            raise ValueError("max_calls and window_s must be positive")
        self.max_calls, self.window_s = max_calls, window_s
        self._clock, self._sleep = clock, sleep
        self._calls: collections.deque[float] = collections.deque()

    def acquire(self) -> float:
        waited = 0.0
        while True:
            now = self._clock()
            while self._calls and now - self._calls[0] >= self.window_s:
                self._calls.popleft()
            if len(self._calls) < self.max_calls:
                self._calls.append(now)
                return waited
            delay = self.window_s - (now - self._calls[0]) + 0.01
            self._sleep(delay)
            waited += delay
