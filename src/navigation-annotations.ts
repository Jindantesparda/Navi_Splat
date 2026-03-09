import { Vec3 } from 'playcanvas';

import { Events } from './events';
import { Scene } from './scene';

type AnnotationMode = 'none' | 'doodle' | 'arrow' | 'point';
type StrokeKind = 'doodle' | 'arrow';

interface NavStroke {
    id: string;
    kind: StrokeKind;
    points: [number, number, number][];
}

interface NavPoint {
    id: string;
    title: string;
    description: string;
    position: [number, number, number];
}

interface NavState {
    points: NavPoint[];
    strokes: NavStroke[];
}

const clamp = (value: number, min: number, max: number) => {
    return Math.max(min, Math.min(max, value));
};

const worldToArray = (value: Vec3): [number, number, number] => {
    return [value.x, value.y, value.z];
};

const arrayToWorld = (value: [number, number, number]): Vec3 => {
    return new Vec3(value[0], value[1], value[2]);
};

class NavigationAnnotations {
    private scene: Scene;
    private events: Events;
    private container: HTMLDivElement;
    private drawCanvas: HTMLCanvasElement;
    private drawContext: CanvasRenderingContext2D;
    private markerLayer: HTMLDivElement;
    private infoBubble: HTMLDivElement;
    private pointSelectFrom: HTMLSelectElement;
    private pointSelectTo: HTMLSelectElement;

    private mode: AnnotationMode = 'none';
    private points: NavPoint[] = [];
    private strokes: NavStroke[] = [];
    private markerNodes = new Map<string, HTMLButtonElement>();
    private activePointId: string | null = null;

    private drawingStroke: NavStroke | null = null;
    private arrowStart: [number, number, number] | null = null;
    private pointerDown = false;
    private isSampling = false;
    private queuedSample: { x: number, y: number } | null = null;
    private idCounter = 0;
    private isVisible = false;

    constructor(scene: Scene, events: Events, host: HTMLElement) {
        this.scene = scene;
        this.events = events;

        this.container = document.createElement('div');
        this.container.id = 'navigation-annotations';
        host.appendChild(this.container);

        this.drawCanvas = document.createElement('canvas');
        this.drawCanvas.id = 'navigation-annotations-canvas';
        const context = this.drawCanvas.getContext('2d');
        if (!context) {
            throw new Error('Failed to create annotation canvas context');
        }
        this.drawContext = context;
        this.container.appendChild(this.drawCanvas);

        this.markerLayer = document.createElement('div');
        this.markerLayer.id = 'navigation-marker-layer';
        this.container.appendChild(this.markerLayer);

        this.infoBubble = document.createElement('div');
        this.infoBubble.id = 'navigation-info-bubble';
        this.infoBubble.hidden = true;
        this.container.appendChild(this.infoBubble);

        this.pointSelectFrom = document.createElement('select');
        this.pointSelectTo = document.createElement('select');

        this.container.appendChild(this.buildPanel());
        this.bindPointerEvents();

        this.applyVisibility();

        events.on('navigation.toggle', () => {
            this.isVisible = !this.isVisible;
            this.applyVisibility();
            if (!this.isVisible) {
                // reset mode when hidden so it doesn't intercept clicks
                this.mode = 'none';
                this.updateModeButtons();
            }
        });

        events.on('prerender', () => {
            this.render();
        });

        events.on('scene.clear', () => {
            this.deserialize(null);
        });

        events.function('navigation.serialize', () => {
            return this.serialize();
        });

        events.on('navigation.deserialize', (state: NavState | null) => {
            this.deserialize(state);
        });
    }

    private applyVisibility() {
        if (this.isVisible) {
            this.container.style.display = 'block';
        } else {
            this.container.style.display = 'none';
        }
        this.events.fire('navigation.visible', this.isVisible);
    }

    private buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'navigation-control-panel';
        panel.addEventListener('pointerdown', (event) => event.stopPropagation());

        const title = document.createElement('div');
        title.className = 'navigation-title';
        title.textContent = 'Navi_Splat Tools';
        panel.appendChild(title);

        const modeRow = document.createElement('div');
        modeRow.className = 'navigation-row';
        panel.appendChild(modeRow);

        modeRow.appendChild(this.makeModeButton('Doodle', 'doodle'));
        modeRow.appendChild(this.makeModeButton('Arrow', 'arrow'));
        modeRow.appendChild(this.makeModeButton('Point Note', 'point'));
        modeRow.appendChild(this.makeModeButton('Pan', 'none'));

        const clearRow = document.createElement('div');
        clearRow.className = 'navigation-row';
        panel.appendChild(clearRow);

        const clearButton = document.createElement('button');
        clearButton.className = 'navigation-action';
        clearButton.textContent = 'Clear All';
        clearButton.addEventListener('click', () => {
            this.points = [];
            this.strokes = [];
            this.activePointId = null;
            this.infoBubble.hidden = true;
            this.syncMarkerNodes();
            this.refreshPointSelects();
            this.events.fire('navigation.changed');
            this.render();
        });
        clearRow.appendChild(clearButton);

        const navTitle = document.createElement('div');
        navTitle.className = 'navigation-subtitle';
        navTitle.textContent = 'Camera Route';
        panel.appendChild(navTitle);

        const fromRow = document.createElement('div');
        fromRow.className = 'navigation-row';
        panel.appendChild(fromRow);

        const fromLabel = document.createElement('label');
        fromLabel.textContent = 'From';
        fromRow.appendChild(fromLabel);
        fromRow.appendChild(this.pointSelectFrom);

        const toRow = document.createElement('div');
        toRow.className = 'navigation-row';
        panel.appendChild(toRow);

        const toLabel = document.createElement('label');
        toLabel.textContent = 'To';
        toRow.appendChild(toLabel);
        toRow.appendChild(this.pointSelectTo);

        const travelRow = document.createElement('div');
        travelRow.className = 'navigation-row';
        panel.appendChild(travelRow);

        const travelButton = document.createElement('button');
        travelButton.className = 'navigation-action';
        travelButton.textContent = 'Auto Move Camera';
        travelButton.addEventListener('click', () => {
            this.moveCameraBetweenSelectedPoints();
        });
        travelRow.appendChild(travelButton);

        this.refreshPointSelects();
        this.updateModeButtons();
        return panel;
    }

    private makeModeButton(label: string, mode: AnnotationMode) {
        const button = document.createElement('button');
        button.className = 'navigation-mode';
        button.textContent = label;
        button.dataset.mode = mode;
        button.addEventListener('click', () => {
            this.mode = mode;
            this.updateModeButtons();
        });
        return button;
    }

    private updateModeButtons() {
        this.container.querySelectorAll<HTMLButtonElement>('.navigation-mode').forEach((button) => {
            const isActive = button.dataset.mode === this.mode;
            button.classList.toggle('active', isActive);
        });
    }

    private bindPointerEvents() {
        const target = this.scene.canvas;

        target.addEventListener('pointerdown', (event) => {
            void this.onPointerDown(event);
        }, true);

        target.addEventListener('pointermove', (event) => {
            void this.onPointerMove(event);
        }, true);

        target.addEventListener('pointerup', (event) => {
            void this.onPointerUp(event);
        }, true);
    }

    private normalizePointer(event: PointerEvent) {
        const rect = this.scene.canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return null;
        }

        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) {
            return null;
        }

        return {
            x: clamp(x, 0, 1),
            y: clamp(y, 0, 1)
        };
    }

    private async pickPoint(x: number, y: number) {
        const result = await this.scene.camera.intersect(x, y);
        return result?.position ?? null;
    }

    private async onPointerDown(event: PointerEvent) {
        if (event.button !== 0 || this.mode === 'none') {
            return;
        }

        const point = this.normalizePointer(event);
        if (!point) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (this.mode === 'point') {
            const position = await this.pickPoint(point.x, point.y);
            if (!position) {
                return;
            }
            this.createPoint(position);
            return;
        }

        this.pointerDown = true;

        if (this.mode === 'doodle') {
            this.drawingStroke = {
                id: `stroke-${this.idCounter++}`,
                kind: 'doodle',
                points: []
            };
            await this.queuePointSample(point.x, point.y);
        } else if (this.mode === 'arrow') {
            const position = await this.pickPoint(point.x, point.y);
            this.arrowStart = position ? worldToArray(position) : null;
        }
    }

    private async onPointerMove(event: PointerEvent) {
        if (!this.pointerDown || this.mode !== 'doodle') {
            return;
        }

        const point = this.normalizePointer(event);
        if (!point) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        await this.queuePointSample(point.x, point.y);
    }

    private async onPointerUp(event: PointerEvent) {
        if (!this.pointerDown) {
            return;
        }

        const point = this.normalizePointer(event);
        if (point) {
            event.preventDefault();
            event.stopPropagation();
        }

        this.pointerDown = false;

        if (this.mode === 'doodle' && this.drawingStroke) {
            if (this.drawingStroke.points.length > 1) {
                this.strokes.push(this.drawingStroke);
                this.events.fire('navigation.changed');
            }
            this.drawingStroke = null;
            this.render();
            return;
        }

        if (this.mode === 'arrow' && this.arrowStart && point) {
            const end = await this.pickPoint(point.x, point.y);
            if (end) {
                this.strokes.push({
                    id: `stroke-${this.idCounter++}`,
                    kind: 'arrow',
                    points: [this.arrowStart, worldToArray(end)]
                });
                this.events.fire('navigation.changed');
                this.render();
            }
            this.arrowStart = null;
        }
    }

    private async queuePointSample(x: number, y: number) {
        this.queuedSample = { x, y };
        if (this.isSampling) {
            return;
        }

        this.isSampling = true;
        while (this.queuedSample) {
            const pending = this.queuedSample;
            this.queuedSample = null;

            const world = await this.pickPoint(pending.x, pending.y);
            if (world && this.drawingStroke) {
                const candidate = worldToArray(world);
                const previous = this.drawingStroke.points[this.drawingStroke.points.length - 1];
                if (!previous || this.pointDistance(previous, candidate) > 0.03) {
                    this.drawingStroke.points.push(candidate);
                    this.render();
                }
            }
        }
        this.isSampling = false;
    }

    private pointDistance(a: [number, number, number], b: [number, number, number]) {
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        const dz = a[2] - b[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private createPoint(position: Vec3) {
        const title = (window.prompt('Point title', `Point ${this.points.length + 1}`) ?? '').trim();
        if (!title) {
            return;
        }

        const description = (window.prompt('Point description', '') ?? '').trim();
        const point: NavPoint = {
            id: `point-${this.idCounter++}`,
            title,
            description,
            position: worldToArray(position)
        };

        this.points.push(point);
        this.activePointId = point.id;
        this.syncMarkerNodes();
        this.refreshPointSelects(point.id);
        this.events.fire('navigation.changed');
        this.render();
    }

    private refreshPointSelects(preferredId?: string) {
        const updateSelect = (element: HTMLSelectElement, fallback: string) => {
            const previous = preferredId ?? element.value;
            element.innerHTML = '';

            if (this.points.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'No points';
                element.appendChild(option);
                element.disabled = true;
                return;
            }

            element.disabled = false;
            this.points.forEach((point) => {
                const option = document.createElement('option');
                option.value = point.id;
                option.textContent = point.title;
                element.appendChild(option);
            });

            const nextValue = this.points.find((point) => point.id === previous)?.id ?? fallback;
            element.value = nextValue;
        };

        updateSelect(this.pointSelectFrom, this.points[0]?.id ?? '');
        updateSelect(this.pointSelectTo, this.points[Math.min(1, this.points.length - 1)]?.id ?? this.points[0]?.id ?? '');
    }

    private moveCameraBetweenSelectedPoints() {
        const fromId = this.pointSelectFrom.value;
        const toId = this.pointSelectTo.value;
        if (!fromId || !toId || fromId === toId) {
            return;
        }

        const from = this.points.find((point) => point.id === fromId);
        const to = this.points.find((point) => point.id === toId);
        if (!from || !to) {
            return;
        }

        const start = arrayToWorld(from.position);
        const end = arrayToWorld(to.position);
        const direction = new Vec3();
        direction.sub2(end, start);
        const length = direction.length();
        if (length <= 1e-4) {
            return;
        }

        direction.mulScalar(1 / length);
        const cameraPosition = start.clone()
            .sub(direction.mulScalar(Math.min(2, length * 0.25)))
            .add(new Vec3(0, 0.5, 0));

        this.events.fire('camera.setPose', {
            position: cameraPosition,
            target: end
        }, 0.3);
    }

    private showPointInfo(point: NavPoint, screenX: number, screenY: number) {
        this.activePointId = point.id;
        this.infoBubble.hidden = false;
        this.infoBubble.style.left = `${screenX + 16}px`;
        this.infoBubble.style.top = `${screenY + 8}px`;
        this.infoBubble.replaceChildren();
        const title = document.createElement('strong');
        title.textContent = point.title;
        this.infoBubble.appendChild(title);
        if (point.description) {
            const description = document.createElement('p');
            description.textContent = point.description;
            this.infoBubble.appendChild(description);
        }
    }

    private syncMarkerNodes() {
        const liveIds = new Set(this.points.map(point => point.id));
        this.markerNodes.forEach((node, id) => {
            if (!liveIds.has(id)) {
                node.remove();
                this.markerNodes.delete(id);
            }
        });

        this.points.forEach((point) => {
            if (this.markerNodes.has(point.id)) {
                return;
            }

            const marker = document.createElement('button');
            marker.className = 'navigation-point';
            marker.textContent = 'o';
            marker.title = point.title;
            marker.addEventListener('pointerdown', (event) => {
                event.stopPropagation();
            });
            marker.addEventListener('click', (event) => {
                event.stopPropagation();
                const target = event.currentTarget as HTMLElement;
                const x = parseFloat(target.style.left ?? '0');
                const y = parseFloat(target.style.top ?? '0');
                this.showPointInfo(point, x, y);
                this.refreshPointSelects(point.id);
            });

            this.markerLayer.appendChild(marker);
            this.markerNodes.set(point.id, marker);
        });
    }

    private render() {
        const width = this.scene.canvas.clientWidth;
        const height = this.scene.canvas.clientHeight;
        if (width <= 0 || height <= 0) {
            return;
        }

        const devicePixelRatio = window.devicePixelRatio || 1;
        const internalWidth = Math.ceil(width * devicePixelRatio);
        const internalHeight = Math.ceil(height * devicePixelRatio);

        if (this.drawCanvas.width !== internalWidth || this.drawCanvas.height !== internalHeight) {
            this.drawCanvas.width = internalWidth;
            this.drawCanvas.height = internalHeight;
            this.drawCanvas.style.width = `${width}px`;
            this.drawCanvas.style.height = `${height}px`;
        }

        const context = this.drawContext;
        context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.lineWidth = 3;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.strokeStyle = '#ff7a1a';
        context.fillStyle = '#ff7a1a';

        const drawStroke = (stroke: NavStroke) => {
            const projected = stroke.points
                .map(point => this.projectPoint(point, width, height))
                .filter((value): value is { x: number, y: number } => value !== null);

            if (projected.length < 2) {
                return;
            }

            context.beginPath();
            context.moveTo(projected[0].x, projected[0].y);
            for (let i = 1; i < projected.length; ++i) {
                context.lineTo(projected[i].x, projected[i].y);
            }
            context.stroke();

            if (stroke.kind === 'arrow') {
                const tail = projected[projected.length - 2];
                const head = projected[projected.length - 1];
                const dx = head.x - tail.x;
                const dy = head.y - tail.y;
                const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const ux = dx / len;
                const uy = dy / len;
                const size = 12;
                const leftX = head.x - ux * size - uy * (size * 0.45);
                const leftY = head.y - uy * size + ux * (size * 0.45);
                const rightX = head.x - ux * size + uy * (size * 0.45);
                const rightY = head.y - uy * size - ux * (size * 0.45);

                context.beginPath();
                context.moveTo(head.x, head.y);
                context.lineTo(leftX, leftY);
                context.lineTo(rightX, rightY);
                context.closePath();
                context.fill();
            }
        };

        this.strokes.forEach(drawStroke);
        if (this.drawingStroke) {
            drawStroke(this.drawingStroke);
        }

        this.points.forEach((point) => {
            const marker = this.markerNodes.get(point.id);
            if (!marker) {
                return;
            }

            const projected = this.projectPoint(point.position, width, height);
            if (!projected) {
                marker.hidden = true;
                return;
            }

            marker.hidden = false;
            marker.style.left = `${projected.x}px`;
            marker.style.top = `${projected.y}px`;
            marker.classList.toggle('active', this.activePointId === point.id);
        });
    }

    private projectPoint(point: [number, number, number], width: number, height: number) {
        const projected = new Vec3();
        this.scene.camera.worldToScreen(arrayToWorld(point), projected);

        if (projected.z < -1 || projected.z > 1) {
            return null;
        }

        return {
            x: projected.x * width,
            y: projected.y * height
        };
    }

    private serialize(): NavState {
        return {
            points: this.points.map(point => ({ ...point })),
            strokes: this.strokes.map(stroke => ({
                id: stroke.id,
                kind: stroke.kind,
                points: stroke.points.map(point => [...point] as [number, number, number])
            }))
        };
    }

    private deserialize(state: NavState | null) {
        this.points = (state?.points ?? []).map(point => ({ ...point }));
        this.strokes = (state?.strokes ?? []).map(stroke => ({
            id: stroke.id,
            kind: stroke.kind,
            points: stroke.points.map(point => [...point] as [number, number, number])
        }));

        this.idCounter = Math.max(this.points.length + this.strokes.length + 1, this.idCounter);
        this.activePointId = null;
        this.infoBubble.hidden = true;
        this.syncMarkerNodes();
        this.refreshPointSelects();
        this.render();
    }
}

const registerNavigationAnnotations = (scene: Scene, events: Events, host: HTMLElement) => {
    new NavigationAnnotations(scene, events, host);
};

export { registerNavigationAnnotations };
