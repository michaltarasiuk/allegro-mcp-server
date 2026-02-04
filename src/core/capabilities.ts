export function buildCapabilities() {
  return {
    logging: {},
    prompts: {
      listChanged: true,
    },
    resources: {
      listChanged: true,
      subscribe: true,
    },
    tools: {
      listChanged: true,
    },
  };
}
