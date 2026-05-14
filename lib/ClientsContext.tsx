'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { clients as initialClients, type Client, type Task } from './data';

interface ClientsContextValue {
  clients: Client[];
  getClient: (id: string) => Client | undefined;
  setTasks: (clientId: string, tasks: Task[]) => void;
  addTask: (clientId: string, task: Task) => void;
  toggleTask: (clientId: string, idx: number, done: boolean) => void;
}

const ClientsContext = createContext<ClientsContextValue | null>(null);

export function ClientsProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Client[]>(initialClients);

  const getClient = useCallback(
    (id: string) => clients.find(c => c.id === id),
    [clients]
  );

  const setTasks = useCallback((clientId: string, tasks: Task[]) => {
    setClients(prev =>
      prev.map(c => c.id === clientId ? { ...c, plan: tasks } : c)
    );
  }, []);

  const addTask = useCallback((clientId: string, task: Task) => {
    setClients(prev =>
      prev.map(c =>
        c.id === clientId ? { ...c, plan: [...(c.plan || []), task] } : c
      )
    );
  }, []);

  const toggleTask = useCallback((clientId: string, idx: number, done: boolean) => {
    setClients(prev =>
      prev.map(c => {
        if (c.id !== clientId || !c.plan) return c;
        const plan = c.plan.map((t, i) => i === idx ? { ...t, done } : t);
        return { ...c, plan };
      })
    );
  }, []);

  return (
    <ClientsContext.Provider value={{ clients, getClient, setTasks, addTask, toggleTask }}>
      {children}
    </ClientsContext.Provider>
  );
}

export function useClients() {
  const ctx = useContext(ClientsContext);
  if (!ctx) throw new Error('useClients must be used inside ClientsProvider');
  return ctx;
}
