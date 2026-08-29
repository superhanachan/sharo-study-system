class Whiteboard {
    constructor() {
        this.overlay = document.getElementById('whiteboard-overlay');
        this.canvas = document.getElementById('wb-canvas');
        if (!this.canvas || !this.overlay) return;
        
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.currentColor = '#ffffff'; // Default white
        this.lineWidth = 3;
        this.isEraser = false;

        this.initEvents();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    initEvents() {
        // Toggle button in sidebar
        const toggleBtn = document.getElementById('sidebar-whiteboard-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggle());
        }

        // Toolbar buttons
        document.getElementById('wb-close').addEventListener('click', () => this.close());
        document.getElementById('wb-clear').addEventListener('click', () => this.clear());
        
        const btnWhite = document.getElementById('wb-color-white');
        const btnRed = document.getElementById('wb-color-red');
        const btnBlue = document.getElementById('wb-color-blue');
        const btnEraser = document.getElementById('wb-eraser');

        const tools = [btnWhite, btnRed, btnBlue, btnEraser];
        
        const setActive = (btn) => {
            tools.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
        };

        btnWhite.addEventListener('click', () => { this.isEraser = false; this.currentColor = '#ffffff'; this.lineWidth = 3; setActive(btnWhite); });
        btnRed.addEventListener('click', () => { this.isEraser = false; this.currentColor = '#f72585'; this.lineWidth = 3; setActive(btnRed); });
        btnBlue.addEventListener('click', () => { this.isEraser = false; this.currentColor = '#4cc9f0'; this.lineWidth = 3; setActive(btnBlue); });
        btnEraser.addEventListener('click', () => { this.isEraser = true; this.lineWidth = 25; setActive(btnEraser); });

        // Drawing events (Pointer events for mouse + touch + pen)
        this.canvas.addEventListener('pointerdown', this.startDrawing.bind(this));
        this.canvas.addEventListener('pointermove', this.draw.bind(this));
        this.canvas.addEventListener('pointerup', this.stopDrawing.bind(this));
        this.canvas.addEventListener('pointercancel', this.stopDrawing.bind(this));
        this.canvas.addEventListener('pointerout', this.stopDrawing.bind(this));
        
        // Prevent scrolling on touch
        this.canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    }

    resize() {
        // Save current canvas content
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = this.canvas.width;
        tempCanvas.height = this.canvas.height;
        if(this.canvas.width > 0 && this.canvas.height > 0) {
            tempCtx.drawImage(this.canvas, 0, 0);
        }

        // Resize
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight - 50; // minus toolbar height approx

        // Restore
        if(tempCanvas.width > 0 && tempCanvas.height > 0) {
            this.ctx.drawImage(tempCanvas, 0, 0);
        }
        
        // Setup context
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    toggle() {
        if (this.overlay.classList.contains('hidden')) {
            this.open();
        } else {
            this.close();
        }
    }

    open() {
        this.overlay.classList.remove('hidden');
        this.resize();
        
        // Close sidebar on mobile so whiteboard has full focus if needed
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
        }
    }

    close() {
        // Automatically clear the board when closed
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.overlay.classList.add('hidden');
    }

    clear() {
        if (confirm('ホワイトボードを全消去しますか？')) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    getPointerPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    startDrawing(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return; // Only left click
        this.isDrawing = true;
        const pos = this.getPointerPos(e);
        this.lastX = pos.x;
        this.lastY = pos.y;
    }

    draw(e) {
        if (!this.isDrawing) return;
        // prevent default on touch moves handled globally, but here we can just ensure smooth draw
        e.preventDefault(); 
        const pos = this.getPointerPos(e);
        
        this.ctx.beginPath();
        if (this.isEraser) {
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.lineWidth = this.lineWidth;
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.strokeStyle = this.currentColor;
            this.ctx.lineWidth = this.lineWidth;
            
            // Pressure sensitivity for styluses
            if (e.pointerType === 'pen' && e.pressure) {
                // Modulate thickness slightly based on pressure
                this.ctx.lineWidth = this.lineWidth * (0.5 + e.pressure);
            }
        }
        
        this.ctx.moveTo(this.lastX, this.lastY);
        this.ctx.lineTo(pos.x, pos.y);
        this.ctx.stroke();
        
        this.lastX = pos.x;
        this.lastY = pos.y;
    }

    stopDrawing() {
        this.isDrawing = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Slight delay to ensure app.js finishes rendering UI and buttons
    setTimeout(() => {
        window.whiteboard = new Whiteboard();
    }, 500);
});
