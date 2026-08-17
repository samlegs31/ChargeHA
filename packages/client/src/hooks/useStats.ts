import { useCallback, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import type { StatsPeriod, StatsResponse } from "@chargeha/shared";
import { trpc } from "../trpc.ts";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type StatsViewPeriod = StatsPeriod | "total";
export type StatsViewResponse = Omit<StatsResponse, "period"> & {
  period: StatsViewPeriod;
};

function formatCursorLabel(period: StatsViewPeriod, cursor: Date): string {
  switch (period) {
    case "day": {
      const options: Intl.DateTimeFormatOptions = {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      };
      return cursor.toLocaleDateString("en-US", options);
    }
    case "month":
      return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
    case "year":
      return String(cursor.getFullYear());
    case "total":
      return "All years";
  }
}

function isSamePeriod(period: StatsViewPeriod, a: Date, b: Date): boolean {
  switch (period) {
    case "day":
      return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
      );
    case "month":
      return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth()
      );
    case "year":
      return a.getFullYear() === b.getFullYear();
    case "total":
      return true;
  }
}

function shiftCursor(
  period: StatsViewPeriod,
  cursor: Date,
  direction: -1 | 1,
): Date {
  const d = new Date(cursor);
  switch (period) {
    case "day":
      d.setDate(d.getDate() + direction);
      break;
    case "month":
      d.setDate(1);
      d.setMonth(d.getMonth() + direction);
      break;
    case "year":
      d.setFullYear(d.getFullYear() + direction);
      break;
    case "total":
      break;
  }
  return d;
}

function cursorToDateStr(cursor: Date): string {
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}-${
    String(cursor.getDate()).padStart(2, "0")
  }`;
}

export type DayResolution = "15m" | "1h";

export function useStats() {
  const [period, setPeriod] = useState<StatsViewPeriod>("day");
  const [resolution, setResolution] = useState<DayResolution>("1h");
  const [cursor, setCursor] = useState<Date>(() => new Date());

  const tz = useMemo(() => -(new Date().getTimezoneOffset() / 60), []);

  const dayQuery = trpc.stats.day.useQuery(
    {
      date: cursorToDateStr(cursor),
      tz,
      resolution: resolution === "15m" ? "15m" : undefined,
    },
    { enabled: period === "day", placeholderData: keepPreviousData },
  );

  const monthQuery = trpc.stats.month.useQuery(
    { year: cursor.getFullYear(), month: cursor.getMonth() + 1, tz },
    { enabled: period === "month", placeholderData: keepPreviousData },
  );

  const yearQuery = trpc.stats.year.useQuery(
    { year: cursor.getFullYear(), tz },
    { enabled: period === "year", placeholderData: keepPreviousData },
  );

  const totalQuery = trpc.stats.total.useQuery(
    { tz },
    { enabled: period === "total", placeholderData: keepPreviousData },
  );

  const queries = {
    day: dayQuery,
    month: monthQuery,
    year: yearQuery,
    total: totalQuery,
  };
  const activeQuery = queries[period];
  const data = activeQuery.data as StatsViewResponse | undefined;
  const { isLoading, error } = activeQuery;

  const isAtPresent = useMemo(
    () => isSamePeriod(period, cursor, new Date()),
    [period, cursor],
  );

  const cursorLabel = useMemo(
    () => formatCursorLabel(period, cursor),
    [period, cursor],
  );

  const goBack = useCallback(() => {
    setCursor((c) => shiftCursor(period, c, -1));
  }, [period]);

  const goForward = useCallback(() => {
    if (!isAtPresent) {
      setCursor((c) => shiftCursor(period, c, 1));
    }
  }, [period, isAtPresent]);

  const goToToday = useCallback(() => {
    setCursor(new Date());
  }, []);

  const changePeriod = useCallback((p: StatsViewPeriod) => {
    setPeriod(p);
    setCursor(new Date());
  }, []);

  const drillDown = useCallback((p: StatsViewPeriod, date: Date) => {
    setPeriod(p);
    setCursor(date);
  }, []);

  return {
    period,
    setPeriod: changePeriod,
    resolution,
    setResolution,
    cursor,
    cursorLabel,
    isAtPresent,
    data: data ?? null,
    loading: isLoading,
    error: error?.message ?? null,
    goBack,
    goForward,
    goToToday,
    drillDown,
  };
}
