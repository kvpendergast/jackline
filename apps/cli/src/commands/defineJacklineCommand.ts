import { defineCommand, type ArgsDef, type CommandContext } from "citty";

type JacklineCommandDef<T extends ArgsDef = ArgsDef> = {
  meta: {
    name: string;
    description: string;
    version?: string;
  };
  args?: T;
  setup?: (context: CommandContext<T>) => void | Promise<void>;
  cleanup?: (context: CommandContext<T>) => void | Promise<void>;
  run: (context: CommandContext<T>) => void | Promise<void>;
};

/**
 * Shared wrapper for Jackline CLI commands. Put cross-cutting behavior here
 * (error formatting, tracing, shared flags) as the CLI grows.
 */
export function defineJacklineCommand<T extends ArgsDef = ArgsDef>(
  def: JacklineCommandDef<T>,
) {
  return defineCommand({
    meta: def.meta,
    ...(def.args ? { args: def.args } : {}),
    ...(def.setup ? { setup: def.setup } : {}),
    ...(def.cleanup ? { cleanup: def.cleanup } : {}),
    async run(ctx) {
      await def.run(ctx as CommandContext<T>);
    },
  });
}
