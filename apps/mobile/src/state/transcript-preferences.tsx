import { useSQLiteContext } from "expo-sqlite";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

type Preferences = { detailed: boolean; reasoning: boolean };
const defaults: Preferences = { detailed: false, reasoning: false };
const Context = createContext({
  ...defaults,
  busy: false,
  error: false,
  update: async (_patch: Partial<Preferences>) => {},
});

export function TranscriptPreferencesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [preferences, setPreferences] = useState(defaults);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const writing = useRef(false);
  useEffect(() => {
    let active = true;
    void db
      .getFirstAsync<{ detailed: number; reasoning: number }>(
        "SELECT detailed, reasoning FROM transcript_preferences WHERE singleton = 1",
      )
      .then((row) => {
        if (active && row)
          setPreferences({ detailed: row.detailed === 1, reasoning: row.reasoning === 1 });
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [db]);

  async function update(patch: Partial<Preferences>) {
    if (busy || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(false);
    const next = { ...preferences, ...patch };
    try {
      await db.runAsync(
        "UPDATE transcript_preferences SET detailed = ?, reasoning = ? WHERE singleton = 1",
        Number(next.detailed),
        Number(next.reasoning),
      );
      setPreferences(next);
    } catch {
      setError(true);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return (
    <Context.Provider value={{ ...preferences, busy, error, update }}>{children}</Context.Provider>
  );
}

export function useTranscriptPreferences() {
  return useContext(Context);
}
