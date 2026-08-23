
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { StoryTurn, TrackedCharacter, ChatTree, StoryNode, UserPersonaDetails, StoryBible, PerCharacterState, WorldModelBranchState } from '../../types';

interface GameState {
  storyHistory: StoryTurn[];
  chatTree: ChatTree | null;
  trackedCharacters: TrackedCharacter[];
  userPersonaDetails: UserPersonaDetails | null;
  isLoading: boolean;
  loadingStatus: string;
  error: string | null;
  streamingNodeId: string | null; // Replaces streamingScene, tracks which node is updating
  autosaveStatus: string;
  // World Model state (per chat)
  storyBible: StoryBible | null;
  perCharacterStates: Record<string, PerCharacterState>;
  worldModelStatesByNodeId: Record<string, WorldModelBranchState>;
  // Lore book lock — frozen first-message branch index, null while chat is empty.
  lockedFirstMessageIndex: number | null;
  // Snapshot of the user-picked base setting so setting-type lore can be re-composed.
  baseCharacterSetting: string | null;
  // Snapshot of the character's base scenario so scenario-type lore can be re-composed.
  baseCharacterScenario: string | null;
  // Manually-toggled scenarios (experimental): ids of the character's
  // manualScenarios switched on for this chat. Injected before story history.
  activeManualScenarioIds: string[];
}

const initialState: GameState = {
  storyHistory: [],
  chatTree: null,
  trackedCharacters: [],
  userPersonaDetails: null,
  isLoading: false,
  loadingStatus: '',
  error: null,
  streamingNodeId: null,
  autosaveStatus: '',
  storyBible: null,
  perCharacterStates: {},
  worldModelStatesByNodeId: {},
  lockedFirstMessageIndex: null,
  baseCharacterSetting: null,
  baseCharacterScenario: null,
  activeManualScenarioIds: [],
};

// Helper to traverse the tree based on selected indices and build the linear history
export const deriveHistoryFromTree = (tree: ChatTree | null): StoryTurn[] => {
    if (!tree) return [];
    const history: StoryTurn[] = [];
    const root = tree.nodes[tree.rootNodeId];
    if (!root) return [];

    // Root itself is a container. Its children are the start of the conversation (e.g. greetings).
    let nextNodeId: string | undefined = root.childrenIds[root.selectedChildIndex ?? 0];
    const visited = new Set<string>();

    while (nextNodeId) {
        if (visited.has(nextNodeId)) {
            console.error("Cycle detected in chat tree at node:", nextNodeId);
            break;
        }
        visited.add(nextNodeId);

        const node = tree.nodes[nextNodeId];
        if (!node) break;

        const parent = tree.nodes[node.parentId!];
        const siblingCount = parent ? parent.childrenIds.length : 1;
        const currentSiblingIndex = parent ? (parent.selectedChildIndex ?? 0) : 0;

        history.push({
            ...node.content,
            branchInfo: {
                nodeId: node.id,
                parentId: node.parentId,
                current: currentSiblingIndex + 1,
                total: siblingCount
            }
        });

        if (node.childrenIds.length > 0) {
             nextNodeId = node.childrenIds[node.selectedChildIndex ?? 0];
        } else {
            nextNodeId = undefined;
        }
    }
    return history;
};

const findCurrentLeafNodeId = (tree: ChatTree | null): string | null => {
    if (!tree) return null;
    let nextNodeId: string | undefined = tree.nodes[tree.rootNodeId]?.childrenIds[tree.nodes[tree.rootNodeId]?.selectedChildIndex ?? 0];
    let lastNodeId: string | null = null;
    const visited = new Set<string>();

    while (nextNodeId) {
        if (visited.has(nextNodeId)) break;
        visited.add(nextNodeId);
        const node = tree.nodes[nextNodeId];
        if (!node) break;
        lastNodeId = node.id;
        nextNodeId = node.childrenIds[node.selectedChildIndex ?? 0];
    }

    return lastNodeId;
};

const findNearestWorldModelState = (
    tree: ChatTree | null,
    statesByNodeId: Record<string, WorldModelBranchState>,
    fromNodeId: string | null
): WorldModelBranchState | null => {
    if (!tree || !fromNodeId) return null;
    let current = tree.nodes[fromNodeId];

    while (current) {
        const state = statesByNodeId[current.id];
        if (state) return state;
        current = current.parentId ? tree.nodes[current.parentId] : undefined;
    }

    return null;
};

const syncWorldModelStateFromActiveBranch = (state: GameState) => {
    const leafId = findCurrentLeafNodeId(state.chatTree);
    const branchState = findNearestWorldModelState(state.chatTree, state.worldModelStatesByNodeId, leafId);
    if (branchState) {
        state.storyBible = branchState.storyBible;
        state.perCharacterStates = branchState.perCharacterStates ?? {};
    } else {
        state.storyBible = null;
        state.perCharacterStates = {};
    }
};

const gameSlice = createSlice({
  name: 'game',
  initialState,
  reducers: {
    setStoryHistory(state, action: PayloadAction<StoryTurn[]>) {
      state.storyHistory = action.payload;
    },
    setChatTree(state, action: PayloadAction<ChatTree>) {
        state.chatTree = action.payload;
        state.storyHistory = deriveHistoryFromTree(action.payload);
        syncWorldModelStateFromActiveBranch(state);
    },
    // Adds a node to the tree. If parentId is provided, adds as child.
    // If no parentId, appends to the current leaf of the derived history.
    addNodeToTree(state, action: PayloadAction<{ node: Omit<StoryNode, 'childrenIds' | 'selectedChildIndex'> }>) {
        if (!state.chatTree) return;

        const { node } = action.payload;
        const newNode: StoryNode = {
            ...node,
            childrenIds: [],
            selectedChildIndex: 0,
        };
        
        state.chatTree.nodes[newNode.id] = newNode;

        if (newNode.parentId && state.chatTree.nodes[newNode.parentId]) {
            const parent = state.chatTree.nodes[newNode.parentId];
            parent.childrenIds.push(newNode.id);
            // Auto-select the new node
            parent.selectedChildIndex = parent.childrenIds.length - 1;
        }
        
        // Update linear history view
        state.storyHistory = deriveHistoryFromTree(state.chatTree);
    },
    // Updates the content of an existing node
    updateNode(state, action: PayloadAction<{ nodeId: string, content: Partial<StoryTurn> }>) {
        if (!state.chatTree || !state.chatTree.nodes[action.payload.nodeId]) return;
        
        const node = state.chatTree.nodes[action.payload.nodeId];
        node.content = { ...node.content, ...action.payload.content };
        
        // Re-derive history to reflect changes (e.g. text update)
        state.storyHistory = deriveHistoryFromTree(state.chatTree);
    },
    // Navigates to a specific sibling index for a parent node
    navigateBranch(state, action: PayloadAction<{ parentId: string, newIndex: number }>) {
        if (!state.chatTree || !state.chatTree.nodes[action.payload.parentId]) return;
        
        const parent = state.chatTree.nodes[action.payload.parentId];
        if (action.payload.newIndex >= 0 && action.payload.newIndex < parent.childrenIds.length) {
            parent.selectedChildIndex = action.payload.newIndex;
            state.storyHistory = deriveHistoryFromTree(state.chatTree);
            syncWorldModelStateFromActiveBranch(state);
        }
    },
    // Legacy reducers (kept for compatibility but usage should be minimized)
    addTurn(state, action: PayloadAction<StoryTurn>) {
      state.storyHistory.push(action.payload);
    },
    updateTurn(state, action: PayloadAction<{ id: string; text: string }>) {
      // Update flat history
      const turn = state.storyHistory.find(t => t.id === action.payload.id);
      if (turn) {
          turn.text = action.payload.text;
      }
      // Sync with tree if it exists
      if (state.chatTree && state.chatTree.nodes[action.payload.id]) {
          state.chatTree.nodes[action.payload.id].content.text = action.payload.text;
          const clearWorldModelData = (nodeId: string) => {
              const node = state.chatTree?.nodes[nodeId];
              if (!node) return;
              delete state.worldModelStatesByNodeId[nodeId];
              delete node.content.worldSnapshot;
              delete node.content.agentResponses;
              node.childrenIds.forEach(clearWorldModelData);
          };
          clearWorldModelData(action.payload.id);
          // Force re-derive to ensure consistency
          state.storyHistory = deriveHistoryFromTree(state.chatTree);
          syncWorldModelStateFromActiveBranch(state);
      }
    },
    deleteTurn(state, action: PayloadAction<string>) {
      // Cut the selected branch and remove its descendants so saved chats do not
      // accumulate orphaned nodes.
      if (state.chatTree && state.chatTree.nodes[action.payload]) {
          const node = state.chatTree.nodes[action.payload];
          if (node.parentId && state.chatTree.nodes[node.parentId]) {
              const parent = state.chatTree.nodes[node.parentId];
              const removedIndex = parent.childrenIds.indexOf(action.payload);
              const previousSelectedIndex = parent.selectedChildIndex ?? 0;
              parent.childrenIds = parent.childrenIds.filter(id => id !== action.payload);
              
              if (parent.childrenIds.length === 0) {
                  parent.selectedChildIndex = 0;
              } else if (removedIndex >= 0 && removedIndex < previousSelectedIndex) {
                  parent.selectedChildIndex = Math.max(0, previousSelectedIndex - 1);
              } else {
                  parent.selectedChildIndex = Math.min(previousSelectedIndex, parent.childrenIds.length - 1);
              }
          }

          const idsToDelete = new Set<string>();
          const collectSubtree = (nodeId: string) => {
              idsToDelete.add(nodeId);
              const childNode = state.chatTree?.nodes[nodeId];
              childNode?.childrenIds.forEach(collectSubtree);
          };
          collectSubtree(action.payload);
          idsToDelete.forEach(id => {
              delete state.chatTree!.nodes[id];
              delete state.worldModelStatesByNodeId[id];
          });

          state.storyHistory = deriveHistoryFromTree(state.chatTree);
          syncWorldModelStateFromActiveBranch(state);
      } else {
          // Fallback for flat history
          const index = state.storyHistory.findIndex(t => t.id === action.payload);
          if (index !== -1) {
            state.storyHistory = state.storyHistory.slice(0, index);
          }
      }
    },
    toggleTurnExpansion(state, action: PayloadAction<string>) {
      const turn = state.storyHistory.find(t => t.id === action.payload);
      if (turn) {
          turn.isExpanded = !turn.isExpanded;
          // Sync with tree
          if (state.chatTree && state.chatTree.nodes[turn.id]) {
              state.chatTree.nodes[turn.id].content.isExpanded = turn.isExpanded;
          }
      }
    },
    setTrackedCharacters(state, action: PayloadAction<TrackedCharacter[]>) {
      state.trackedCharacters = action.payload;
    },
    setUserPersonaDetails(state, action: PayloadAction<UserPersonaDetails | null>) {
      state.userPersonaDetails = action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    setLoadingStatus(state, action: PayloadAction<string>) {
      state.loadingStatus = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    setStreamingNodeId(state, action: PayloadAction<string | null>) {
      state.streamingNodeId = action.payload;
    },
    setAutosaveStatus(state, action: PayloadAction<string>) {
      state.autosaveStatus = action.payload;
    },
    setStoryBible(state, action: PayloadAction<StoryBible | null>) {
      state.storyBible = action.payload;
      const leafId = findCurrentLeafNodeId(state.chatTree);
      if (leafId) {
        state.worldModelStatesByNodeId[leafId] = {
          storyBible: state.storyBible,
          perCharacterStates: state.perCharacterStates,
        };
      }
    },
    updateStoryBibleFragment(
      state,
      action: PayloadAction<{ field: keyof StoryBible; value: any }>
    ) {
      if (!state.storyBible) return;
      // Type-safe enough at runtime: caller controls the field/value pair.
      (state.storyBible as any)[action.payload.field] = action.payload.value;
      state.storyBible.lastEdited = Date.now();
    },
    clearStoryBible(state) {
      state.storyBible = null;
      state.perCharacterStates = {};
      state.worldModelStatesByNodeId = {};
    },
    setPerCharacterStates(state, action: PayloadAction<Record<string, PerCharacterState>>) {
      state.perCharacterStates = action.payload;
      const leafId = findCurrentLeafNodeId(state.chatTree);
      if (leafId) {
        state.worldModelStatesByNodeId[leafId] = {
          storyBible: state.storyBible,
          perCharacterStates: state.perCharacterStates,
        };
      }
    },
    setWorldModelStatesByNodeId(state, action: PayloadAction<Record<string, WorldModelBranchState>>) {
      state.worldModelStatesByNodeId = action.payload ?? {};
      syncWorldModelStateFromActiveBranch(state);
    },
    setWorldModelStateForNode(
      state,
      action: PayloadAction<{ nodeId: string; state: WorldModelBranchState }>
    ) {
      state.worldModelStatesByNodeId[action.payload.nodeId] = action.payload.state;
      state.storyBible = action.payload.state.storyBible;
      state.perCharacterStates = action.payload.state.perCharacterStates ?? {};
    },
    setLockedFirstMessageIndex(state, action: PayloadAction<number | null>) {
      state.lockedFirstMessageIndex = action.payload;
    },
    setBaseCharacterSetting(state, action: PayloadAction<string | null>) {
      state.baseCharacterSetting = action.payload;
    },
    setBaseCharacterScenario(state, action: PayloadAction<string | null>) {
      state.baseCharacterScenario = action.payload;
    },
    setActiveManualScenarioIds(state, action: PayloadAction<string[]>) {
      state.activeManualScenarioIds = action.payload;
    },
    toggleManualScenario(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.activeManualScenarioIds = state.activeManualScenarioIds.includes(id)
        ? state.activeManualScenarioIds.filter(x => x !== id)
        : [...state.activeManualScenarioIds, id];
    },
    resetGame(state) {
      return initialState;
    }
  },
});

export const {
  setStoryHistory, setChatTree, addNodeToTree, updateNode, navigateBranch,
  addTurn, updateTurn, deleteTurn, toggleTurnExpansion,
  setTrackedCharacters, setUserPersonaDetails, setLoading, setLoadingStatus, setError,
  setStreamingNodeId, setAutosaveStatus,
  setStoryBible, updateStoryBibleFragment, clearStoryBible, setPerCharacterStates,
  setWorldModelStatesByNodeId, setWorldModelStateForNode,
  setLockedFirstMessageIndex,
  setBaseCharacterSetting,
  setBaseCharacterScenario,
  setActiveManualScenarioIds,
  toggleManualScenario,
  resetGame
} = gameSlice.actions;

export default gameSlice.reducer;
