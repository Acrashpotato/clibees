import { computed, type ComputedRef } from "vue";

import type {
  TaskBoardDependencyEdge,
  TaskBoardDependencyState,
  TaskBoardProjectionView,
  TaskBoardTaskNode,
} from "../../task-board-projection";

const TASK_NODE_WIDTH_PX = 320;
const TASK_NODE_HEIGHT_PX = 180;
const TASK_SEQUENCE_STEP_X_PX = TASK_NODE_WIDTH_PX + 150;
const TASK_SEQUENCE_WAVE_AMPLITUDE_PX = 110;
const TASK_SEQUENCE_DEPTH_BAND_PX = 34;
const TASK_SEQUENCE_PHASE_RAD = 0.86;
const TASK_GRAPH_PADDING_X_PX = 36;
const TASK_GRAPH_PADDING_Y_PX = 28;
const TASK_EDGE_CHANNEL_PX = 24;
const TASK_SEQUENCE_TRACK_COUNT = 4;
const TASK_SEQUENCE_TRACK_GAP_PX = 14;
const TASK_SEQUENCE_TRACK_OFFSET_PX = 18;
const TASK_EXPLICIT_LANE_GAP_PX = 10;
const TASK_GRAPH_EXTRA_BOTTOM_PX =
  TASK_SEQUENCE_TRACK_OFFSET_PX + TASK_SEQUENCE_TRACK_COUNT * TASK_SEQUENCE_TRACK_GAP_PX + 26;

export type TaskGraphLink = {
  key: string;
  pathId: string;
  fromTaskId: string;
  toTaskId: string;
  linkType: "explicit" | "sequence";
  state?: TaskBoardDependencyState;
  path: string;
};

export type TaskGraphNode = {
  task: TaskBoardTaskNode;
  order: number;
  depth: number;
  x: number;
  y: number;
  centerX: number;
  centerY: number;
  taskId: string;
  style: Record<string, string>;
};

export function useTaskGraph(projection: ComputedRef<TaskBoardProjectionView>) {
  const orderedTasks = computed(() =>
    buildDependencyOrderedTasks(projection.value.tasks, projection.value.edges),
  );
  const taskOrderById = computed(() => {
    const orderMap = new Map<string, number>();
    orderedTasks.value.forEach((task, index) => {
      orderMap.set(task.taskId, index + 1);
    });
    return orderMap;
  });
  const orderedEdges = computed(() => {
    const orderMap = taskOrderById.value;
    return [...projection.value.edges].sort((left, right) => {
      const leftFrom = orderMap.get(left.fromTaskId) ?? Number.MAX_SAFE_INTEGER;
      const rightFrom = orderMap.get(right.fromTaskId) ?? Number.MAX_SAFE_INTEGER;
      if (leftFrom !== rightFrom) {
        return leftFrom - rightFrom;
      }

      const leftTo = orderMap.get(left.toTaskId) ?? Number.MAX_SAFE_INTEGER;
      const rightTo = orderMap.get(right.toTaskId) ?? Number.MAX_SAFE_INTEGER;
      if (leftTo !== rightTo) {
        return leftTo - rightTo;
      }

      return left.edgeId.localeCompare(right.edgeId);
    });
  });

  const taskGraphNodes = computed<TaskGraphNode[]>(() => {
    const tasks = orderedTasks.value;
    if (tasks.length === 0) {
      return [];
    }

    const depthCenter =
      tasks.reduce((sum, task) => sum + task.depth, 0) / tasks.length;

    const rawNodes = tasks.map((task, index) => {
      const x = TASK_GRAPH_PADDING_X_PX + index * TASK_SEQUENCE_STEP_X_PX;
      const waveY = Math.sin(index * TASK_SEQUENCE_PHASE_RAD) * TASK_SEQUENCE_WAVE_AMPLITUDE_PX;
      const depthY = (task.depth - depthCenter) * TASK_SEQUENCE_DEPTH_BAND_PX;
      const rawY = waveY + depthY;

      return {
        task,
        order: index + 1,
        depth: task.depth,
        x,
        rawY,
        taskId: task.taskId,
      };
    });

    const minRawY = rawNodes.reduce((minValue, node) => Math.min(minValue, node.rawY), 0);
    const yOffset = TASK_GRAPH_PADDING_Y_PX + Math.abs(Math.min(0, minRawY)) + 8;

    return rawNodes.map((node) => {
      const y = yOffset + node.rawY;
      return {
        task: node.task,
        order: node.order,
        depth: node.depth,
        x: node.x,
        y,
        centerX: node.x + TASK_NODE_WIDTH_PX / 2,
        centerY: y + TASK_NODE_HEIGHT_PX / 2,
        taskId: node.taskId,
        style: {
          left: `${node.x}px`,
          top: `${y}px`,
          width: `${TASK_NODE_WIDTH_PX}px`,
          height: `${TASK_NODE_HEIGHT_PX}px`,
        },
      };
    });
  });

  const taskNodeById = computed(() => {
    const nodeMap = new Map<string, TaskGraphNode>();
    for (const node of taskGraphNodes.value) {
      nodeMap.set(node.taskId, node);
    }
    return nodeMap;
  });

  const taskGraphSize = computed(() => {
    const nodes = taskGraphNodes.value;
    if (nodes.length === 0) {
      return {
        width: TASK_NODE_WIDTH_PX + TASK_GRAPH_PADDING_X_PX * 2,
        height: TASK_NODE_HEIGHT_PX + TASK_GRAPH_PADDING_Y_PX * 2 + TASK_GRAPH_EXTRA_BOTTOM_PX,
      };
    }

    const maxRight = nodes.reduce((maxValue, node) => Math.max(maxValue, node.x + TASK_NODE_WIDTH_PX), 0);
    const maxBottom = nodes.reduce((maxValue, node) => Math.max(maxValue, node.y + TASK_NODE_HEIGHT_PX), 0);

    return {
      width: maxRight + TASK_GRAPH_PADDING_X_PX,
      height: maxBottom + TASK_GRAPH_PADDING_Y_PX + TASK_GRAPH_EXTRA_BOTTOM_PX,
    };
  });

  const taskGraphCanvasStyle = computed<Record<string, string>>(() => ({
    width: `${taskGraphSize.value.width}px`,
    height: `${taskGraphSize.value.height}px`,
    minWidth: "100%",
  }));
  const taskGraphViewBox = computed(() => `0 0 ${taskGraphSize.value.width} ${taskGraphSize.value.height}`);

  const taskGraphLinks = computed<TaskGraphLink[]>(() => {
    const nodes = taskGraphNodes.value;
    if (nodes.length <= 1) {
      return [];
    }

    const nodeMap = taskNodeById.value;
    const links: TaskGraphLink[] = [];
    const explicitPairKeys = new Set<string>();

    for (const edge of orderedEdges.value) {
      explicitPairKeys.add(edgePairKey(edge.fromTaskId, edge.toTaskId));
    }

    for (let index = 0; index < nodes.length - 1; index += 1) {
      const fromNode = nodes[index];
      const toNode = nodes[index + 1];
      const pairKey = edgePairKey(fromNode.taskId, toNode.taskId);
      if (explicitPairKeys.has(pairKey)) {
        continue;
      }

      links.push({
        key: `seq:${fromNode.taskId}->${toNode.taskId}`,
        pathId: asSvgPathId(`seq-${fromNode.taskId}-${toNode.taskId}`),
        fromTaskId: fromNode.taskId,
        toTaskId: toNode.taskId,
        linkType: "sequence",
        state: undefined,
        path: buildTaskGraphPath(fromNode, toNode, "sequence", index, taskGraphSize.value.height),
      });
    }

    let explicitLane = 0;
    for (const edge of orderedEdges.value) {
      const fromNode = nodeMap.get(edge.fromTaskId);
      const toNode = nodeMap.get(edge.toTaskId);
      if (!fromNode || !toNode) {
        continue;
      }

      explicitLane += 1;
      links.push({
        key: `edge:${edge.edgeId}`,
        pathId: asSvgPathId(`edge-${edge.edgeId}`),
        fromTaskId: edge.fromTaskId,
        toTaskId: edge.toTaskId,
        linkType: "explicit",
        state: edge.state,
        path: buildTaskGraphPath(fromNode, toNode, "explicit", explicitLane, taskGraphSize.value.height),
      });
    }

    return links;
  });

  function orderedTaskPosition(taskId: string): number {
    return taskOrderById.value.get(taskId) ?? 0;
  }

  return {
    orderedTasks,
    orderedEdges,
    taskGraphNodes,
    taskGraphLinks,
    taskGraphCanvasStyle,
    taskGraphViewBox,
    orderedTaskPosition,
  };
}

export function linkDirection(
  link: TaskGraphLink,
  taskId: string | undefined,
): "incoming" | "outgoing" | "none" {
  if (!taskId) {
    return "none";
  }
  if (link.fromTaskId === taskId) {
    return "outgoing";
  }
  if (link.toTaskId === taskId) {
    return "incoming";
  }
  return "none";
}

export function isLinkRelated(link: TaskGraphLink, taskId: string | undefined): boolean {
  if (!taskId) {
    return true;
  }
  return link.fromTaskId === taskId || link.toTaskId === taskId;
}

export function showLinkLabel(link: TaskGraphLink, taskId: string | undefined): boolean {
  if (link.linkType !== "explicit") {
    return false;
  }
  return isLinkRelated(link, taskId);
}

function buildDependencyOrderedTasks(
  tasks: TaskBoardTaskNode[],
  edges: TaskBoardDependencyEdge[],
): TaskBoardTaskNode[] {
  if (tasks.length <= 1) {
    return tasks;
  }

  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const indexById = new Map(tasks.map((task, index) => [task.taskId, index]));
  const upstreamCounts = new Map<string, number>();
  const downstream = new Map<string, string[]>();

  for (const task of tasks) {
    upstreamCounts.set(task.taskId, 0);
    downstream.set(task.taskId, []);
  }

  for (const edge of edges) {
    if (!taskById.has(edge.fromTaskId) || !taskById.has(edge.toTaskId)) {
      continue;
    }

    const downstreamTaskIds = downstream.get(edge.fromTaskId);
    if (!downstreamTaskIds || downstreamTaskIds.includes(edge.toTaskId)) {
      continue;
    }

    downstreamTaskIds.push(edge.toTaskId);
    upstreamCounts.set(edge.toTaskId, (upstreamCounts.get(edge.toTaskId) ?? 0) + 1);
  }

  const sortTaskIds = (taskIds: string[]): string[] =>
    taskIds.sort((leftId, rightId) => {
      const leftTask = taskById.get(leftId);
      const rightTask = taskById.get(rightId);

      if (!leftTask || !rightTask) {
        return 0;
      }

      if (leftTask.depth !== rightTask.depth) {
        return leftTask.depth - rightTask.depth;
      }

      return (indexById.get(leftId) ?? 0) - (indexById.get(rightId) ?? 0);
    });

  const readyQueue = sortTaskIds(
    [...upstreamCounts.entries()].filter(([, count]) => count === 0).map(([taskId]) => taskId),
  );
  const orderedTaskIds: string[] = [];

  while (readyQueue.length > 0) {
    const taskId = readyQueue.shift();
    if (!taskId) {
      continue;
    }

    orderedTaskIds.push(taskId);

    for (const downstreamTaskId of downstream.get(taskId) ?? []) {
      const remainingUpstream = (upstreamCounts.get(downstreamTaskId) ?? 0) - 1;
      upstreamCounts.set(downstreamTaskId, remainingUpstream);
      if (remainingUpstream === 0) {
        readyQueue.push(downstreamTaskId);
      }
    }

    sortTaskIds(readyQueue);
  }

  if (orderedTaskIds.length < tasks.length) {
    const seenTaskIds = new Set(orderedTaskIds);
    const remainingTaskIds = sortTaskIds(
      tasks.map((task) => task.taskId).filter((taskId) => !seenTaskIds.has(taskId)),
    );
    orderedTaskIds.push(...remainingTaskIds);
  }

  return orderedTaskIds
    .map((taskId) => taskById.get(taskId))
    .filter((task): task is TaskBoardTaskNode => Boolean(task));
}

function edgePairKey(fromTaskId: string, toTaskId: string): string {
  return `${fromTaskId}>>${toTaskId}`;
}

function asSvgPathId(key: string): string {
  return `task-flow-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function explicitLaneShift(laneIndex: number): number {
  const lane = laneIndex % 7;
  return (lane - 3) * TASK_EXPLICIT_LANE_GAP_PX;
}

function buildTaskGraphPath(
  fromNode: TaskGraphNode,
  toNode: TaskGraphNode,
  linkType: "explicit" | "sequence",
  laneIndex: number,
  graphHeight: number,
): string {
  if (linkType === "sequence") {
    const startX = fromNode.centerX;
    const startY = fromNode.y + TASK_NODE_HEIGHT_PX;
    const endX = toNode.centerX;
    const endY = toNode.y + TASK_NODE_HEIGHT_PX;
    const sequenceLane = laneIndex % TASK_SEQUENCE_TRACK_COUNT;
    const channelY =
      graphHeight -
      TASK_GRAPH_PADDING_Y_PX -
      TASK_SEQUENCE_TRACK_OFFSET_PX -
      sequenceLane * TASK_SEQUENCE_TRACK_GAP_PX;

    return [
      `M ${startX} ${startY}`,
      `L ${startX} ${channelY}`,
      `L ${endX} ${channelY}`,
      `L ${endX} ${endY}`,
    ].join(" ");
  }

  const startY = fromNode.centerY;
  const endY = toNode.centerY;
  const laneShift = explicitLaneShift(laneIndex);
  const startX = fromNode.x + TASK_NODE_WIDTH_PX;
  const endX = toNode.x;
  const horizontalGap = endX - startX;

  if (horizontalGap >= TASK_EDGE_CHANNEL_PX * 2) {
    const elbowOutX = startX + TASK_EDGE_CHANNEL_PX;
    const elbowInX = endX - TASK_EDGE_CHANNEL_PX;
    const middleBaseY = (startY + endY) / 2;
    const bandMinY = Math.min(startY, endY) + 16;
    const bandMaxY = Math.max(startY, endY) - 16;
    const middleY =
      bandMinY < bandMaxY
        ? clamp(middleBaseY + laneShift, bandMinY, bandMaxY)
        : middleBaseY + laneShift;
    return [
      `M ${startX} ${startY}`,
      `L ${elbowOutX} ${startY}`,
      `L ${elbowOutX} ${middleY}`,
      `L ${elbowInX} ${middleY}`,
      `L ${elbowInX} ${endY}`,
      `L ${endX} ${endY}`,
    ].join(" ");
  }

  if (horizontalGap >= 0) {
    const sideX = startX + TASK_EDGE_CHANNEL_PX + Math.max(0, laneShift / 2);
    return [
      `M ${startX} ${startY}`,
      `L ${sideX} ${startY}`,
      `L ${sideX} ${endY}`,
      `L ${endX} ${endY}`,
    ].join(" ");
  }

  const backStartX = fromNode.x;
  const backEndX = toNode.x + TASK_NODE_WIDTH_PX;
  const backLane = laneIndex % 5;
  const channelY = Math.max(12, Math.min(fromNode.y, toNode.y) - 34 - backLane * 18 + laneShift);
  const outX = backStartX - TASK_EDGE_CHANNEL_PX;
  const inX = backEndX + TASK_EDGE_CHANNEL_PX;
  return [
    `M ${backStartX} ${startY}`,
    `L ${outX} ${startY}`,
    `L ${outX} ${channelY}`,
    `L ${inX} ${channelY}`,
    `L ${inX} ${endY}`,
    `L ${backEndX} ${endY}`,
  ].join(" ");
}
