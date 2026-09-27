import { useEffect, useRef, useState } from "react";
import { Group, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { FloorLayout, SavedFloor } from "@campus-access/shared";

export function FloorLayoutView({ floor }: { floor: SavedFloor }) {
  return (
    <div
      className="floor-preview"
      style={{
        aspectRatio: `${floor.layout.canvasWidth} / ${floor.layout.canvasHeight}`,
      }}
    >
      {floor.layout.blocks.map((block) => (
        <div
          key={block.id}
          className="floor-preview-block"
          style={{
            left: `${block.x * 100}%`,
            top: `${block.y * 100}%`,
            width: `${block.width * 100}%`,
            height: `${block.height * 100}%`,
          }}
        >
          <span>{block.name}</span>
        </div>
      ))}
    </div>
  );
}

interface DesignerProps {
  value: FloorLayout;
  onChange(value: FloorLayout): void;
}

type LayoutBlock = FloorLayout["blocks"][number];
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

function BlockNode({
  block,
  width,
  height,
  selected,
  onSelect,
  onChange,
}: {
  block: LayoutBlock;
  width: number;
  height: number;
  selected: boolean;
  onSelect(): void;
  onChange(block: LayoutBlock): void;
}) {
  const group = useRef<Konva.Group>(null);
  const transformer = useRef<Konva.Transformer>(null);
  useEffect(() => {
    if (selected && group.current && transformer.current) {
      transformer.current.nodes([group.current]);
      transformer.current.getLayer()?.batchDraw();
    }
  }, [selected]);
  const x = block.x * width;
  const y = block.y * height;
  const blockWidth = block.width * width;
  const blockHeight = block.height * height;
  const commit = (): void => {
    const node = group.current;
    if (!node) return;
    const nextWidth = clamp(blockWidth * node.scaleX(), 32, width);
    const nextHeight = clamp(blockHeight * node.scaleY(), 28, height);
    node.scale({ x: 1, y: 1 });
    onChange({
      ...block,
      x: clamp(node.x() / width, 0, 1 - nextWidth / width),
      y: clamp(node.y() / height, 0, 1 - nextHeight / height),
      width: nextWidth / width,
      height: nextHeight / height,
    });
  };
  return (
    <>
      <Group
        ref={group}
        x={x}
        y={y}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={commit}
        onTransformEnd={commit}
        dragBoundFunc={(position) => ({
          x: clamp(position.x, 0, width - blockWidth),
          y: clamp(position.y, 0, height - blockHeight),
        })}
      >
        <Rect
          width={blockWidth}
          height={blockHeight}
          fill={selected ? "#f6c66b" : "#ead7ad"}
          stroke={selected ? "#288466" : "#47655c"}
          strokeWidth={selected ? 3 : 2}
          cornerRadius={6}
        />
        <Text
          text={block.name}
          width={blockWidth}
          height={blockHeight}
          padding={Math.min(8, blockWidth * 0.06, blockHeight * 0.1)}
          align="center"
          verticalAlign="middle"
          fontSize={clamp(
            Math.min(
              blockHeight * 0.24,
              blockWidth / Math.max(4, block.name.length * 0.58),
            ),
            9,
            24,
          )}
          fill="#20333e"
          ellipsis
          wrap="none"
          listening={false}
        />
      </Group>
      {selected && (
        <Transformer
          ref={transformer}
          rotateEnabled={false}
          keepRatio={false}
          flipEnabled={false}
          boundBoxFunc={(oldBox, newBox) => {
            const outside =
              newBox.x < 0 ||
              newBox.y < 0 ||
              newBox.x + newBox.width > width ||
              newBox.y + newBox.height > height;
            return newBox.width < 32 || newBox.height < 28 || outside
              ? oldBox
              : newBox;
          }}
        />
      )}
    </>
  );
}

const percent = (value: number): number => Math.round(value * 1000) / 10;

export function FloorDesigner({ value, onChange }: DesignerProps) {
  const shell = useRef<HTMLDivElement>(null);
  const addBlockButton = useRef<HTMLButtonElement>(null);
  const addBlockDialog = useRef<HTMLDialogElement>(null);
  const blockNameInput = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(620);
  const [selected, setSelected] = useState<string | null>(null);
  const [isAddingBlock, setIsAddingBlock] = useState(false);
  const [blockName, setBlockName] = useState("");
  const [blockNameError, setBlockNameError] = useState("");
  const [renameError, setRenameError] = useState("");
  const height = Math.round((width * value.canvasHeight) / value.canvasWidth);
  const selectedBlock =
    value.blocks.find((block) => block.id === selected) ?? null;
  useEffect(() => {
    if (!shell.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.min(860, entry?.contentRect.width ?? 620)));
    });
    observer.observe(shell.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (selected && !value.blocks.some((block) => block.id === selected))
      setSelected(null);
  }, [selected, value.blocks]);
  useEffect(() => setRenameError(""), [selected]);
  useEffect(() => {
    if (!isAddingBlock) return;
    const dialog = addBlockDialog.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    blockNameInput.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      addBlockButton.current?.focus();
    };
  }, [isAddingBlock]);
  const update = (block: LayoutBlock): void =>
    onChange({
      ...value,
      blocks: value.blocks.map((item) => (item.id === block.id ? block : item)),
    });
  const removeSelected = (): void => {
    if (!selected) return;
    onChange({
      ...value,
      blocks: value.blocks.filter((item) => item.id !== selected),
    });
    setSelected(null);
  };
  const closeAddBlock = (): void => {
    setIsAddingBlock(false);
    setBlockName("");
    setBlockNameError("");
  };
  const createBlock = (): void => {
    const name = blockName.trim();
    if (!name) {
      setBlockNameError("Enter a block name.");
      blockNameInput.current?.focus();
      return;
    }
    if (name.length > 100) {
      setBlockNameError("Use 100 characters or fewer.");
      blockNameInput.current?.focus();
      return;
    }
    const id = crypto.randomUUID();
    onChange({
      ...value,
      blocks: [
        ...value.blocks,
        {
          id,
          name,
          x: 0.08,
          y: 0.08,
          width: 0.28,
          height: 0.18,
        },
      ],
    });
    setSelected(id);
    closeAddBlock();
  };
  const updatePercent = (
    property: "x" | "y" | "width" | "height",
    raw: string,
  ): void => {
    if (!selectedBlock) return;
    const number = Number(raw);
    if (!Number.isFinite(number)) return;
    const normalized = number / 100;
    const next = { ...selectedBlock };
    if (property === "x") next.x = clamp(normalized, 0, 1 - next.width);
    if (property === "y") next.y = clamp(normalized, 0, 1 - next.height);
    if (property === "width")
      next.width = clamp(normalized, 32 / value.canvasWidth, 1 - next.x);
    if (property === "height")
      next.height = clamp(normalized, 28 / value.canvasHeight, 1 - next.y);
    update(next);
  };
  return (
    <div className="floor-workspace">
      <div className="floor-editor-main">
        <div className="floor-toolbar" aria-label="Floor drawing tools">
          <div>
            <strong>Floor canvas</strong>
            <span>{value.blocks.length} blocks</span>
          </div>
          <button
            ref={addBlockButton}
            className="button secondary"
            type="button"
            aria-label="Add named block"
            onClick={() => {
              setBlockName("");
              setBlockNameError("");
              setIsAddingBlock(true);
            }}
          >
            + Add block
          </button>
        </div>
        {isAddingBlock && (
          <dialog
            ref={addBlockDialog}
            className="block-dialog"
            aria-labelledby="add-block-title"
            aria-describedby="add-block-description"
            onCancel={(event) => {
              event.preventDefault();
              closeAddBlock();
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) closeAddBlock();
            }}
          >
            <form
              className="block-dialog-card"
              onSubmit={(event) => {
                event.preventDefault();
                createBlock();
              }}
            >
              <div className="block-dialog-heading">
                <p className="panel-eyebrow">Floor canvas</p>
                <h2 id="add-block-title">Add block</h2>
                <p id="add-block-description">
                  Name the room or area you want to place on this floor.
                </p>
              </div>
              <label className="field" htmlFor="new-block-name">
                <span>Block name</span>
                <input
                  ref={blockNameInput}
                  id="new-block-name"
                  value={blockName}
                  placeholder="Computer Lab"
                  autoComplete="off"
                  aria-invalid={Boolean(blockNameError)}
                  aria-describedby={
                    blockNameError ? "block-name-error" : undefined
                  }
                  onChange={(event) => {
                    setBlockName(event.target.value);
                    if (blockNameError) setBlockNameError("");
                  }}
                />
              </label>
              {blockNameError && (
                <p className="field-error" id="block-name-error" role="alert">
                  {blockNameError}
                </p>
              )}
              <div className="block-dialog-actions">
                <button
                  className="button ghost"
                  type="button"
                  onClick={closeAddBlock}
                >
                  Cancel
                </button>
                <button className="button primary" type="submit">
                  Add block
                </button>
              </div>
            </form>
          </dialog>
        )}
        <div className="floor-canvas" ref={shell}>
          <Stage
            width={width}
            height={height}
            onMouseDown={(event) => {
              if (event.target === event.target.getStage()) setSelected(null);
            }}
            onTouchStart={(event) => {
              if (event.target === event.target.getStage()) setSelected(null);
            }}
          >
            <Layer>
              <Rect
                width={width}
                height={height}
                fill="#fbf7ef"
                stroke="#8b9d97"
                strokeWidth={2}
              />
              {value.blocks.map((block) => (
                <BlockNode
                  key={block.id}
                  block={block}
                  width={width}
                  height={height}
                  selected={selected === block.id}
                  onSelect={() => setSelected(block.id)}
                  onChange={update}
                />
              ))}
            </Layer>
          </Stage>
        </div>
      </div>
      {selectedBlock && (
        <aside className="inspector" aria-label="Selected block">
          <div className="panel-heading compact">
            <div>
              <p className="panel-eyebrow">Selected block</p>
              <h2>Block details</h2>
            </div>
          </div>
          <label className="field">
            <span>Name</span>
            <input
              maxLength={100}
              value={selectedBlock.name}
              aria-invalid={Boolean(renameError)}
              aria-describedby={renameError ? "rename-block-error" : undefined}
              onChange={(event) => {
                const name = event.target.value;
                if (!name.trim()) {
                  setRenameError("Enter a block name.");
                  return;
                }
                setRenameError("");
                update({ ...selectedBlock, name });
              }}
            />
          </label>
          {renameError && (
            <p className="field-error" id="rename-block-error" role="alert">
              {renameError}
            </p>
          )}
          <div className="inspector-grid">
            {(
              [
                ["x", "Left"],
                ["y", "Top"],
                ["width", "Width"],
                ["height", "Height"],
              ] as const
            ).map(([property, label]) => (
              <label className="field" key={property}>
                <span>{label} (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={percent(selectedBlock[property])}
                  onChange={(event) =>
                    updatePercent(property, event.target.value)
                  }
                />
              </label>
            ))}
          </div>
          <button
            className="button danger"
            type="button"
            onClick={removeSelected}
          >
            Delete block
          </button>
        </aside>
      )}
    </div>
  );
}
