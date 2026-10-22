/**
 * Composición de dependencias (P1). Es la única capa que conoce adaptadores:
 * los consumidores reciben puertos y los sustituyen en tests.
 *
 * El runtime y las notificaciones arrancan en su adaptador de indisponibilidad:
 * no simulan éxito mientras P4 no implemente el módulo nativo.
 */
import { systemClock, type Clock } from '../domain/alarms.ts';
import { createIdGenerator, type IdGenerator } from '../domain/ids.ts';
import type { AlarmRepository } from '../domain/ports.ts';
import { unavailableAlarmRuntime, type AlarmRuntime } from '../platform/alarms/index.ts';
import { unavailableNotifications, type NotificationPort } from '../platform/notifications/index.ts';

export type AppDependencies = {
  clock: Clock;
  ids: IdGenerator;
  repository: AlarmRepository;
  runtime: AlarmRuntime;
  notifications: NotificationPort;
};

export type AppDependenciesInput = Pick<AppDependencies, 'repository'> & Partial<AppDependencies>;

export function createAppDependencies(input: AppDependenciesInput): AppDependencies {
  return {
    clock: input.clock ?? systemClock,
    ids: input.ids ?? createIdGenerator(),
    repository: input.repository,
    runtime: input.runtime ?? unavailableAlarmRuntime,
    notifications: input.notifications ?? unavailableNotifications,
  };
}
