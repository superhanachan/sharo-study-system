function getMappedLawId(lawId, anchor);

            // Fetch XML from e-Gov API
            const apiUrl = `https://laws.e-gov.go.jp/api/1/lawdata/${fetchLawId}`;
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error("APIレスポンスエラー: " + response.status);
            const xmlText = await response.text();
            
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            
            // Get Law Name
            const lawNameEl = xmlDoc.querySelector("LawTitle") || xmlDoc.querySelector("LawName");
            if (lawNameEl && fetchLawId === lawId) {
                titleEl.textContent = lawNameEl.textContent;
            } else {
                titleEl.textContent = this.getKnownLawName(lawId);
            }

            // Find target element by anchor
            let targetNode = null;
            
            const findArticleInList = (articleList, targetNumStr) => {
                for (let i = 0; i < articleList.length; i++) {
                    const num = articleList[i].getAttribute("Num");
                    if (num === targetNumStr) return articleList[i];
                    if (num && num.includes(':')) {
                        const parts = num.split(':');
                        const s = parseInt(parts[0]);
                        const e = parseInt(parts[1]);
                        const t = parseInt(targetNumStr);
                        if (!isNaN(s) && !isNaN(e) && !isNaN(t) && t >= s && t <= e) {
                            return articleList[i];
                        }
                    }
                }
                return null;
            };

            if (anchor.startsWith('Mp-At_')) {
                // Main Provision - Article
                const articleNum = anchor.replace('Mp-At_', '');
                const articles = xmlDoc.querySelectorAll("Article");
                targetNode = findArticleInList(articles, articleNum);
            } else if (anchor.startsWith('Sp')) {
                // Supplementary Provisions
                const amendMatch = anchor.match(/^Sp_?(.*?)(?:[-_]At_|$)/);
                const rawAmendNum = amendMatch && amendMatch[1] ? amendMatch[1] : null;
                let amendNum = rawAmendNum ? decodeURIComponent(rawAmendNum) : null;
                
                // Fallback for AI hallucinated anchors that lack the AmendLawNum (e.g. #Sp-At_47)
                if (!amendNum && lawId !== fetchLawId) {
                    const AMEND_NUM_MAP = {
                        "412AC0000000018": "平成一二年三月三一日法律第一八号",
                        "416AC0000000104": "平成一六年六月一一日法律第一〇四号",
                        "360AC0000000034": "昭和六〇年五月一日法律第三四号",
                        "406AC0000000095": "平成六年一一月九日法律第九五号",
                        "424AC0000000063": "平成二四年八月二二日法律第六三号"
                    };
                    amendNum = AMEND_NUM_MAP[lawId] || null;
                }
                
                let targetSp = null;
                const spNodes = xmlDoc.querySelectorAll("SupplProvision");
                
                // 1. Exact match
                for (let i = 0; i < spNodes.length; i++) {
                    if (!amendNum && !spNodes[i].hasAttribute("AmendLawNum")) {
                        targetSp = spNodes[i]; break;
                    }
                    if (amendNum && spNodes[i].getAttribute("AmendLawNum") === amendNum) {
                        targetSp = spNodes[i]; break;
                    }
                }
                
                // 2. Fuzzy match (handle e-Gov kanji inconsistencies like 三十四 vs 三四)
                if (!targetSp && amendNum) {
                    const fuzzyAmend = amendNum.replace(/十/g, '');
                    for (let i = 0; i < spNodes.length; i++) {
                        const nodeAmend = spNodes[i].getAttribute("AmendLawNum") || "";
                        if (nodeAmend && nodeAmend.replace(/十/g, '') === fuzzyAmend) {
                            targetSp = spNodes[i]; break;
                        }
                    }
                }
                
                // 3. Ultimate fallback for original law (which lacks AmendLawNum in XML despite URL having one)
                if (!targetSp && spNodes.length > 0 && !spNodes[0].hasAttribute("AmendLawNum")) {
                    targetSp = spNodes[0];
                }
                
                if (targetSp) {
                    // Check for both -At_ and _At_ for robustness against AI hallucinations
                    const atMatch = anchor.match(/[-_]At_([0-9_]+)/);
                    if (atMatch) {
                        const spArticles = targetSp.querySelectorAll("Article");
                        targetNode = findArticleInList(spArticles, atMatch[1]);
                    }
                    if (!targetNode) targetNode = targetSp; // fallback to whole SupplProvision
                }
            } else if (anchor.startsWith('Ap')) {
                // AppdxTable (別表)
                const numStr = anchor.replace(/^A[pP]+_?/, ''); 
                const appdxTables = xmlDoc.querySelectorAll("AppdxTable");
                for (let i = 0; i < appdxTables.length; i++) {
                    const titleEl = appdxTables[i].querySelector("AppdxTableTitle");
                    if (titleEl) {
                        let titleText = titleEl.textContent;
                        titleText = titleText.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
                        titleText = titleText.replace('の', '_');
                        const tMatch = titleText.match(/別表第?([0-9_]+)/);
                        if (tMatch && tMatch[1] === numStr) {
                            targetNode = appdxTables[i];
                            break;
                        }
                    }
                }
            }

            if (!targetNode) {
                // If it's a general law link or unsupported anchor, just show the first article or a message
                const firstArticle = xmlDoc.querySelector("Article");
                if (firstArticle) {
                    targetNode = firstArticle;
                    titleEl.textContent += " (先頭部分)";
                }
            }

            if (!targetNode) {
                contentArea.innerHTML = '<div style="color:var(--error);">指定された条文が見つかりませんでした。お手数ですが「別タブで開く」から公式ページをご確認ください。</div>';
            } else {
                // Simple recursive XML to HTML converter for e-Gov standard tags
                const parseEGovNode = (node) => {
                    let html = '';
                    if (node.nodeType === Node.TEXT_NODE) {
                        return node.textContent;
                    }
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        switch (node.tagName) {
                            case 'ArticleCaption':
                                html += `<div class="egov-caption">【${node.textContent}】</div>`;
                                break;
                            case 'ArticleTitle':
                                html += `<div class="egov-title">${node.textContent}</div>`;
                                break;
                            case 'Paragraph':
                                html += `<div class="egov-paragraph">`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</div>`;
                                break;
                            case 'ParagraphNum':
                                html += `<span style="margin-right: 0.5rem; font-weight: bold;">${node.textContent || ''}</span>`;
                                break;
                            case 'Item':
                                html += `<div class="egov-item">`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</div>`;
                                break;
                            case 'ItemTitle':
                                html += `<span style="margin-right: 0.5rem; font-weight: bold;">${node.textContent}</span>`;
                                break;
                            case 'Sentence':
                            case 'ParagraphSentence':
                            case 'ItemSentence':
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                break;
                            case 'Table':
                                html += `<div style="overflow-x: auto;"><table border="1" style="border-collapse: collapse; margin-top: 1rem; width: 100%; font-size: 0.9em; min-width: 400px;">`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</table></div>`;
                                break;
                            case 'TableRow':
                                html += `<tr>`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</tr>`;
                                break;
                            case 'TableColumn':
                                html += `<td style="padding: 0.5rem; border: 1px solid #ccc; vertical-align: top;">`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</td>`;
                                break;
                            case 'AppdxTableTitle':
                                html += `<div class="egov-title" style="margin-top: 1rem; font-size: 1.2em; font-weight: bold;">${node.textContent}</div>`;
                                break;
                            case 'TableStructTitle':
                                html += `<div style="font-weight: bold; margin-top: 0.5rem;">${node.textContent}</div>`;
                                break;
                            default:
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                break;
                        }
                    }
                    return html;
                };

                contentArea.innerHTML = parseEGovNode(targetNode);
            }
        } catch (error) {
            console.error("e-Gov API fetch error:", error);
            contentArea.innerHTML = `<div style="color:var(--error);">データの取得に失敗しました。<br>お手数ですが右下の「別タブで開く」ボタンからご確認ください。<br><small>${error.message}</small></div>`;
        } finally {
            loadingArea.style.display = 'none';
            contentArea.style.display = 'block';
        }
    }

    deleteRow(id) {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (set.questions.length <= 1) { alert('最低1行は必要です。'); return; }
        if (confirm('この行を削除しますか？')) {
            set.questions = set.questions.filter(q => q.id !== id);
            this.saveData(); this.renderTable();
        }
    }

    moveRow(id, direction) {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        const index = set.questions.findIndex(q => q.id === id);
        if (index === -1) return;

        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= set.questions.length) return;

        // Swap
        const temp = set.questions[index];
        set.questions[index] = set.questions[newIndex];
        set.questions[newIndex] = temp;

        this.saveData();
        this.renderTable();
    }

    deleteColumn(index) {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (set.columns.length <= 2) { alert('最低1つの選択肢は必要です。'); return; }
        const colName = set.columns[index];
        if (confirm(`列「${colName}」を削除しますか？`)) {
            set.columns.splice(index, 1);
            set.questions.forEach(q => {
                if (Array.isArray(q.answer)) q.answer = q.answer.filter(a => a !== colName);
                else if (q.answer === colName) q.answer = set.columns[1];
            });
            this.saveData(); this.renderTable();
        }
    }

    formatDateStr(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    getDueCountMap() {
        const now = new Date();
        const todayStr = this.formatDateStr(now);
        const counts = {};

        // Get filter from dashboard if available
        const todayFilter = this.todayMasterySelect ? this.todayMasterySelect.value : 'all';

        const inPoolSets = new Set();
        const qToSet = new Map();
        this.quizData.forEach(set => {
            if (set.isInPool !== false) inPoolSets.add(set.id);
            if (set.questions) set.questions.forEach(q => qToSet.set(q.id, set.id));
        });

        const isStatInActivePool = (key) => {
            if (key.startsWith('clause-summary-')) return inPoolSets.has(key.replace('clause-summary-', ''));
            if (qToSet.has(key)) return inPoolSets.has(qToSet.get(key));
            return inPoolSets.has(key);
        };

        // Add completely new (Lv0) items to counts
        this.quizData.forEach(set => {
            if (set.isInPool === false) return;
            if (set.type === 'clause') {
                const summaryId = `clause-summary-${set.id}`;
                if (!this.questionStats[summaryId]) {
                    counts[set.id] = (counts[set.id] || 0) + 1;
                }
            } else if (set.type === 'page' && set.questions) {
                set.questions.forEach(q => {
                    if (!this.questionStats[q.id]) {
                        counts[set.id] = (counts[set.id] || 0) + 1;
                    }
                });
            }
        });

        Object.entries(this.questionStats).forEach(([key, s]) => {
            if (!s.nextReview || !isStatInActivePool(key)) return;
            if (key.startsWith('clause-') && !key.startsWith('clause-summary-')) return;
            
            if (this.formatDateStr(new Date(s.nextReview)) <= todayStr) {
                // Apply mastery filter
                if (!this.checkMasteryFilter(s.srsLevel || 0, todayFilter)) return;

                let itemId = s.pageId;
                if (!itemId) {
                    if (key.startsWith('clause-summary-')) itemId = key.replace('clause-summary-', '');
                    else itemId = key;
                }
                counts[itemId] = (counts[itemId] || 0) + 1;
            }
        });
        return counts;
    }

    calculateAllDueCounts() {
        const itemDueMap = this.getDueCountMap();
        const allDueCounts = {};
        
        const childrenMap = {};
        this.quizData.forEach(item => {
            const pid = item.parentId || 'root';
            if (!childrenMap[pid]) childrenMap[pid] = [];
            childrenMap[pid].push(item);
        });

        const walk = (parentId) => {
            let total = 0;
            const children = childrenMap[parentId || 'root'] || [];
            children.forEach(item => {
                if (item.type === 'folder') {
                    total += walk(item.id);
                } else {
                    total += (itemDueMap[item.id] || 0);
                }
            });
            if (parentId) allDueCounts[parentId] = total;
            return total;
        };

        walk(null);
        return { itemDueMap, allDueCounts };
    }

    renderTOC() {
        // Build a flat list in order of display (DFS)
        const getFlatDisplayList = (parentId = null, depth = 0) => {
            let result = [];
            const items = this.quizData.filter(item => (item.parentId || null) === parentId);
            items.forEach(item => {
                const globalIndex = this.quizData.findIndex(d => d.id === item.id);
                result.push({ ...item, depth, globalIndex });
                if (item.type === 'folder' && !item.isCollapsed) {
                    result = result.concat(getFlatDisplayList(item.id, depth + 1));
                }
            });
            return result;
        };

        const list = getFlatDisplayList(null, 0);
        const { itemDueMap, allDueCounts } = this.calculateAllDueCounts();

        this.tocList.innerHTML = list.map(s => {
            const isFolder = s.type === 'folder';
            const isActive = s.id === this.currentSetId && !this.isAutoGenerated && !isFolder;
            const indent = s.depth * 15;

            return `
            <li class="${isActive ? 'active' : ''} ${isFolder ? 'type-folder' : 'type-page'}" 
                style="padding-left: ${indent}px"
                draggable="${this.isEditMode}" 
                oncontextmenu="app.showContextMenu(event, '${s.id}')"
                ondragstart="app.handleDragStart(event, '${s.id}')" 
                ondragover="app.handleDragOver(event, '${s.id}')" 
                ondrop="app.handleDrop(event, '${s.id}')" 
                ondragend="app.handleDragEnd(event)">
                <div class="item-container ${isFolder ? 'folder-item' : ''}">
                    ${isFolder ? `
                        <span class="folder-toggle" onclick="event.stopPropagation(); app.toggleFolder('${s.id}')">
                            ${s.isCollapsed ? '▶' : '▼'}
                        </span>
                        <span class="folder-icon">${s.isCollapsed ? '📁' : '📂'}</span>
                    ` : ''}
                    ${this.isEditMode ? `<input type="checkbox" class="toc-delete-checkbox" data-id="${s.id}" title="削除対象として選択" onclick="event.stopPropagation();" style="accent-color: #e63946; margin-right: 4px; cursor: pointer;">` : ''}
                    <input type="checkbox" class="toc-pool-checkbox" 
                           ${s.isInPool ? 'checked' : ''} 
                           onclick="event.stopPropagation(); app.toggleItemPool('${s.id}')" 
                           title="特訓対象に含める">
                    <a href="#${s.id}" draggable="false" onclick="if('${isFolder}' === 'true') { event.preventDefault(); app.toggleFolder('${s.id}'); }">
                        ${s.title}
                    </a>
                    ${(isFolder && allDueCounts[s.id] > 0) ? `<span class="folder-due-badge" title="本日の復習待ち">${allDueCounts[s.id]}</span>` : ''}
                    ${(!isFolder && itemDueMap[s.id] > 0) ? `<span class="folder-due-badge" title="本日の復習待ち">${itemDueMap[s.id]}</span>` : ''}
                    <div class="reorder-btns">
                        <button class="reorder-btn" onclick="event.stopPropagation(); app.movePageById('${s.id}', -1)">▲</button>
                        <button class="reorder-btn" onclick="event.stopPropagation(); app.movePageById('${s.id}', 1)">▼</button>
                        ${isFolder ? `
                            <button class="reorder-btn" title="子フォルダを追加" onclick="event.stopPropagation(); app.addNewFolder('${s.id}')">＋📁</button>
                            <button class="reorder-btn" title="通常ページを追加" onclick="event.stopPropagation(); app.addNewPage('${s.id}')">＋📄</button>
                            <button class="reorder-btn" title="条文穴埋めを追加" onclick="event.stopPropagation(); app.addNewClausePage('${s.id}')">＋🔤</button>
                            <button class="reorder-btn delete-folder-btn" onclick="event.stopPropagation(); app.deleteFolder('${s.id}')">×</button>
                        ` : ''}
                    </div>
                </div>
            </li>`;
        }).join('');
    }

    handleDragStart(e, id) {
        if (!this.isEditMode) return;
        this.draggedItemId = id;
        e.dataTransfer.setData('text/plain', id);
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    handleDragOver(e, id) {
        if (!this.isEditMode) return;
        e.preventDefault();
        const li = e.currentTarget;
        if (id === this.draggedItemId) return;

        const targetItem = this.quizData.find(i => i.id === id);
        if (!targetItem) return;

        // Clean up previous classes
        li.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-folder');

        const rect = li.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const height = rect.height;

        if (targetItem.type === 'folder') {
            if (relativeY < height * 0.25) {
                li.classList.add('drag-over-top');
                this.dropPosition = 'above';
            } else if (relativeY > height * 0.75) {
                li.classList.add('drag-over-bottom');
                this.dropPosition = 'below';
            } else {
                li.classList.add('drag-over-folder');
                this.dropPosition = 'inside';
            }
        } else {
            if (relativeY < height / 2) {
                li.classList.add('drag-over-top');
                this.dropPosition = 'above';
            } else {
                li.classList.add('drag-over-bottom');
                this.dropPosition = 'below';
            }
        }
    }

    isDescendant(targetId, potentialParentId) {
        let currentParentId = potentialParentId;
        while (currentParentId) {
            if (currentParentId === targetId) return true;
            const parent = this.quizData.find(i => i.id === currentParentId);
            currentParentId = parent ? parent.parentId : null;
        }
        return false;
    }

    handleDrop(e, id) {
        if (!this.isEditMode) return;
        e.preventDefault();
        const targetItem = this.quizData.find(i => i.id === id);
        const draggedItem = this.quizData.find(i => i.id === this.draggedItemId);

        if (!draggedItem || !targetItem || draggedItem.id === id) return;

        if (draggedItem.type === 'folder' && this.isDescendant(draggedItem.id, id)) {
            alert('フォルダを自分自身の子要素に移動することはできません。');
            return;
        }

        const data = [...this.quizData];
        const itemIdx = data.findIndex(i => i.id === this.draggedItemId);
        if (itemIdx === -1) return;
        const item = data.splice(itemIdx, 1)[0];

        if (this.dropPosition === 'inside' && targetItem.type === 'folder') {
            item.parentId = targetItem.id;
            targetItem.isCollapsed = false;
            data.push(item);
        } else {
            item.parentId = targetItem.parentId;
            let targetIdx = data.findIndex(d => d.id === id);
            if (this.dropPosition === 'below') targetIdx++;
            data.splice(targetIdx, 0, item);
        }

        this.quizData = data;
        this.saveData();
        this.renderTOC();
    }

    handleDragEnd(e) {
        this.draggedItemId = null;
        this.renderTOC();
    }

    movePageById(id, direction) {
        const index = this.quizData.findIndex(i => i.id === id);
        if (index !== -1) this.movePage(index, direction);
    }

    toggleFolder(id) {
        const folder = this.quizData.find(s => s.id === id);
        if (folder && folder.type === 'folder') {
            folder.isCollapsed = !folder.isCollapsed;
            this.saveData();
            this.renderTOC();
        }
    }

    showContextMenu(e, id) {
        e.preventDefault();
        e.stopPropagation(); // Prevent bubbling up to window click listener
        this.ctxItemId = id;
        const item = this.quizData.find(s => s.id === id);
        if (!item) return;

        this.contextMenu.style.left = `${e.clientX}px`;
        this.contextMenu.style.top = `${e.clientY}px`;
        this.contextMenu.classList.remove('hidden');

        // Adjust menu content based on item type (Folder vs Page)
        const isFolder = item.type === 'folder';
        const addFolder = document.getElementById('ctx-add-folder');
        const addPage = document.getElementById('ctx-add-page');
        const addClause = document.getElementById('ctx-add-clause');

        if (isFolder) {
            addFolder.textContent = '📁 子フォルダを追加';
            addPage.textContent = '📄 子ページを追加';
            addClause.textContent = '🔤 子条文穴埋めを追加';
        } else {
            addFolder.textContent = '📁 隣にフォルダを追加';
            addPage.textContent = '📄 隣にページを追加';
            addClause.textContent = '🔤 隣に条文穴埋めを追加';
        }

        // Adjust visibility or content of other items if necessary
    }

    hideContextMenu() {
        if (this.contextMenu) this.contextMenu.classList.add('hidden');
    }

    ctxAction(action) {
        const id = this.ctxItemId;
        const item = this.quizData.find(s => s.id === id);
        if (!item) { this.hideContextMenu(); return; }

        // Folders usually get children, pages get siblings
        const parentId = item.type === 'folder' ? item.id : item.parentId;

        switch (action) {
            case 'add-folder': this.addNewFolder(parentId); break;
            case 'add-page': this.addNewPage(parentId); break;
            case 'add-clause': this.addNewClausePage(parentId); break;
            case 'batch-add-clause': this.showBatchAddModal(parentId); break;
            case 'rename':
                const newTitle = prompt('新しい名前を入力してください:', item.title);
                if (newTitle && newTitle.trim()) {
                    item.title = newTitle.trim();
                    this.saveData();
                    this.renderTOC();
                    if (this.currentSetId === id) this.quizTitle.textContent = item.title;
                }
                break;
            case 'move-up': this.movePageById(id, -1); break;
            case 'move-down': this.movePageById(id, 1); break;
            case 'delete':
                if (item.type === 'folder') this.deleteFolder(id);
                else {
                    if (confirm(`このページ（${item.title}）を完全に削除しますか？`)) {
                        this.quizData = this.quizData.filter(s => s.id !== id);
                        this.saveData();
                        this.renderTOC();
                        if (this.currentSetId === id) this.loadSet(null);
                    }
                }
                break;
        }
        this.hideContextMenu();
    }

    toggleItemPool(id) {
        const item = this.quizData.find(s => s.id === id);
        if (!item) return;

        const newState = !item.isInPool;

        // Recursive function to apply state to descendants
        const applyRecursive = (parentId, state) => {
            this.quizData.forEach(child => {
                if (child.parentId === parentId) {
                    child.isInPool = state;
                    if (child.type === 'folder') {
                        applyRecursive(child.id, state);
                    }
                }
            });
        };

        item.isInPool = newState;
        if (item.type === 'folder') {
            applyRecursive(item.id, newState);
        }

        this.saveData();
        this.renderTOC();
        this.updateDashboard();
    }

    clearAllPoolSelections() {
        if (!confirm('特訓対象のチェックをすべて外しますか？')) return;
        this.quizData.forEach(item => {
            item.isInPool = false;
        });
        this.saveData();
        this.renderTOC();
        this.updateDashboard();
    }

    selectAllPoolSelections() {
        if (!confirm('すべての問題を特訓対象に含めますか？')) return;
        this.quizData.forEach(item => {
            item.isInPool = true;
        });
        this.saveData();
        this.renderTOC();
        this.updateDashboard();
    }

    isItemSelectedForPool(itemId) {
        const item = this.quizData.find(i => i.id === itemId);
        return item ? !!item.isInPool : false;
    }

    collapseAllFolders() {
        this.quizData.forEach(item => {
            if (item.type === 'folder') item.isCollapsed = true;
        });
        this.saveData();
        this.renderTOC();
    }

    expandAllFolders() {
        this.quizData.forEach(item => {
            if (item.type === 'folder') item.isCollapsed = false;
        });
        this.saveData();
        this.renderTOC();
    }

    deleteFolder(id) {
        if (!this.isEditMode) return;
        const folder = this.quizData.find(s => s.id === id);
        if (!folder) return;

        const children = this.quizData.filter(item => item.parentId === id);
        let msg = `フォルダ「${folder.title}」を削除しますか？`;
        if (children.length > 0) {
            msg += `\n\n注意：中身の問題（${children.length}件）は削除されませんが、フォルダから出されます。`;
        }

        if (confirm(msg)) {
            // Unparent children
            children.forEach(child => child.parentId = null);
            // Remove folder
            this.quizData = this.quizData.filter(s => s.id !== id);
            this.saveData();
            this.renderTOC();
        }
    }

    addNewFolder(parentId = null) {
        const title = prompt('フォルダ名:');
        if (!title) return;
        const id = 'f-' + Date.now();
        this.quizData.push({
            id, title, type: 'folder', parentId: parentId, isCollapsed: false, isInPool: true
        });
        if (parentId) {
            const parent = this.quizData.find(p => p.id === parentId);
            if (parent) parent.isCollapsed = false;
        }
        this.saveData();
        this.renderTOC();
    }

    movePage(index, direction) {
        const itemsAtSameLevel = this.quizData.filter(item => item.parentId === this.quizData[index].parentId);
        const localIndex = itemsAtSameLevel.findIndex(item => item.id === this.quizData[index].id);
        const newLocalIndex = localIndex + direction;

        if (newLocalIndex < 0 || newLocalIndex >= itemsAtSameLevel.length) return;

        const targetGlobalIndex = this.quizData.findIndex(item => item.id === itemsAtSameLevel[newLocalIndex].id);

        const temp = this.quizData[index];
        this.quizData[index] = this.quizData[targetGlobalIndex];
        this.quizData[targetGlobalIndex] = temp;

        this.saveData();
        this.renderTOC();
    }

    updateActiveTOC(id) {
        this.tocList.querySelectorAll('li').forEach(li => {
            const a = li.querySelector('a');
            const isActive = a && a.getAttribute('href') === `#${id}`;
            li.classList.toggle('active', isActive);
        });
    }

    addNewPage(parentId = null) {
        const title = prompt('タイトル:'); if (!title) return;
        const isMulti = confirm('複数選択（ランキング形式）にしますか？\nOK: 複数選択, キャンセル: 単一選択');
        const id = 'p-' + Date.now();
        const cols = isMulti ? [
            "順位", "【生計維持】", "【生計同一】", "配偶者", "子", "父母", "孫", "祖父母", "兄弟姉妹", "3親等以内", "対象なし"
        ] : ["項目", "選択1", "選択2"];

        const questions = [];
        if (isMulti) {
            for (let i = 1; i <= 6; i++) {
                questions.push({ id: 'q-' + Date.now() + i, text: `第${i}順位`, answer: [] });
            }
        } else {
            questions.push({ id: 'q-' + Date.now(), text: "新問題", answer: cols[1] });
        }

        const newPage = {
            id, title, type: 'page', parentId: parentId, isMultiSelect: isMulti,
            columns: cols,
            questions: questions,
            isInPool: true
        };

        // If current viewing is a folder, maybe add to it? For now, just add to root
        this.quizData.push(newPage);

        this.isAutoGenerated = false;
        this.saveData();
        this.renderTOC();
        this.loadSet(id);

        // Scroll to the new page in the sidebar
        setTimeout(() => {
            const newElem = this.tocList.querySelector(`a[href="#${id}"]`);
            if (newElem) newElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }

    addNewClausePage(parentId = null) {
        const title = prompt('条文穴埋め問題のタイトル:'); if (!title) return;
        const id = 'p-' + Date.now();
        const newPage = {
            id, title, type: 'clause', parentId: parentId,
            text: 'ここに条文を入力してください。[[キーワード]]のように囲むとそこが穴埋めになります。',
            dummies: '',
            isInPool: true
        };
        this.quizData.push(newPage);
        this.saveData();
        this.renderTOC();
        this.loadSet(id);

        setTimeout(() => {
            const newElem = this.tocList.querySelector(`a[href="#${id}"]`);
            if (newElem) newElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
    showBatchAddModal(parentId = null) {
        this.lastBatchParentId = parentId;
        if (this.batchAddModal) {
            this.batchAddModal.classList.remove('hidden');
            if (this.batchAddText) {
                this.batchAddText.value = '';
                this.batchAddText.focus();
            }
        }
    }
    executeBatchAdd() {
        const text = this.batchAddText.value;
        if (!text) {
            if (this.batchAddModal) this.batchAddModal.classList.add('hidden');
            return;
        }
        const blocks = text.split('""').map(b => b.trim()).filter(b => b.length > 0);
        if (blocks.length === 0) {
            if (this.batchAddModal) this.batchAddModal.classList.add('hidden');
            return;
        }
        let firstId = null;
        blocks.forEach((block, index) => {
            const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) return;
            let title = lines[0].replace(/\[\[(.*?)\]\]|［［(.*?)］］|\(\((.*?)\)\)|（（(.*?)））/g, '$1$2$3$4');
            if (title.length > 50) title = title.substring(0, 47) + '...';
            const id = 'p-' + Date.now() + '-' + index;
            if (!firstId) firstId = id;
            const newPage = {
                id, title, type: 'clause', parentId: this.lastBatchParentId || null,
                text: block,
                dummies: [],
                isInPool: true
            };
            this.quizData.push(newPage);
        });
        this.saveData();
        this.renderTOC();
        if (this.batchAddModal) this.batchAddModal.classList.add('hidden');
        this.batchAddText.value = '';
        if (firstId) {
            this.loadSet(firstId);
            setTimeout(() => {
                const newElem = this.tocList.querySelector(`a[href="#${firstId}"]`);
                if (newElem) newElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }

    addNewRow() {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        set.questions.push({
            id: 'q-' + Date.now(),
            text: "新問題...",
            memo: "",
            answer: set.isMultiSelect ? [] : set.columns[1]
        });
        this.saveData();
        this.renderTable();
    }
    addNewColumn() { if (this.isAutoGenerated) return; const set = this.quizData.find(s => s.id === this.currentSetId); const name = prompt('列名:'); if (!name) return; set.columns.push(name); this.saveData(); this.renderTable(); }

    deleteCurrentPage() {
        if (this.quizData.length <= 1 || this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (!set || set.type === 'folder') {
            alert('フォルダを削除する場合は、サイドバーの「×」ボタンを使用してください。');
            return;
        }

        if (confirm(`このページ（${set.title}）の全問題データを削除しますか？\nこの操作は取り消せません。`)) {
            // Safety: if this page had children (unlikely but possible), unparent them
            const children = this.quizData.filter(item => item.parentId === this.currentSetId);
            children.forEach(c => c.parentId = null);

            this.quizData = this.quizData.filter(s => s.id !== this.currentSetId);

            // Find a valid next item (prefer a page)
            let nextItem = this.quizData.find(i => i.type === 'page' || i.type === 'clause');
            if (!nextItem) nextItem = this.quizData[0];

            this.currentSetId = nextItem ? nextItem.id : null;
            this.saveData();
            this.migrateData(); // Rescue orphans if any were created
            this.renderTOC();
            if (this.currentSetId) this.loadSet(this.currentSetId);
            else this.renderTable(); // Show empty state
        }
    }

    showDeleteConfirmModal() {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (!set || !set.questions) return;

        const checks = document.querySelectorAll('.row-select-checkbox:checked');
        if (checks.length === 0) {
            alert('削除する問題を選択してください。');
            return;
        }

        if (!this.deleteConfirmModal || !this.deleteTargetList) return;

        this.deleteTargetType = 'page-rows';
        this.deleteTargetList.innerHTML = '';
        const ul = document.createElement('ul');
        ul.style.listStyleType = 'disc';
        ul.style.paddingLeft = '1.5rem';
        ul.style.margin = '0';

        Array.from(checks).forEach(c => {
            const id = c.dataset.id;
            const q = set.questions.find(q => q.id === id);
            if (q) {
                const li = document.createElement('li');
                li.style.marginBottom = '0.5rem';
                li.textContent = q.text || '(空白の問題)';
                ul.appendChild(li);
            }
        });

        this.deleteTargetList.appendChild(ul);
        this.deleteConfirmModal.classList.remove('hidden');
    }

    showSidebarDeleteConfirmModal() {
        if (!this.isEditMode) return;
        const checks = document.querySelectorAll('.toc-delete-checkbox:checked');
        
        if (checks.length === 0) {
            alert('削除する項目が選択されていません。（赤いチェックボックスをオンにしてください）');
            return;
        }

        const idsToDelete = Array.from(checks).map(c => c.dataset.id);
        const targets = this.quizData.filter(item => idsToDelete.includes(item.id));

        if (!this.deleteConfirmModal || !this.deleteTargetList) return;

        this.deleteTargetType = 'sidebar-items';
        this.deleteTargetList.innerHTML = '';
        const ul = document.createElement('ul');
        ul.style.listStyleType = 'disc';
        ul.style.paddingLeft = '1.5rem';
        ul.style.margin = '0';

        const displayTargets = targets.slice(0, 50);
        displayTargets.forEach(item => {
            const li = document.createElement('li');
            li.style.marginBottom = '0.5rem';
            li.textContent = item.title || '(無題)';
            ul.appendChild(li);
        });

        if (targets.length > 50) {
            const li = document.createElement('li');
            li.style.marginBottom = '0.5rem';
            li.textContent = `...他 ${targets.length - 50} 件`;
            ul.appendChild(li);
        }

        this.deleteTargetList.appendChild(ul);
        this.deleteConfirmModal.classList.remove('hidden');
    }

    executeDeleteSelectedQuestions() {
        try {
            if (this.isAutoGenerated) return;

            if (this.deleteTargetType === 'sidebar-items') {
                const checks = document.querySelectorAll('.toc-delete-checkbox:checked');
                if (checks.length > 0) {
                    const idsToDelete = Array.from(checks).map(c => c.dataset.id);
                    this.quizData = this.quizData.filter(item => !idsToDelete.includes(item.id));
                    
                    idsToDelete.forEach(id => {
                        delete this.questionStats[this.getSummaryStatKey(id, 'page')];
                    });

                    if (idsToDelete.includes(this.currentSetId)) {
                        let nextItem = this.quizData.find(i => i.type === 'page' || i.type === 'clause');
                        this.currentSetId = nextItem ? nextItem.id : null;
                        if (this.currentSetId) this.loadSet(this.currentSetId);
                        else this.renderTable();
                    }

                    this.saveData();
                    this.renderTOC();
                    this.updateDashboard();
                }
            } else {
                const set = this.quizData.find(s => s.id === this.currentSetId);
                if (!set || !set.questions) throw new Error("セットが見つかりません。");

                const checks = document.querySelectorAll('.row-select-checkbox:checked');
                if (checks.length === 0) throw new Error("削除する項目が選択されていません。");

                const idsToDelete = Array.from(checks).map(c => c.dataset.id);
                set.questions = set.questions.filter(q => !idsToDelete.includes(q.id));

                idsToDelete.forEach(id => {
                    const baseId = this.getQuestionBaseId(id);
                    delete this.questionStats[this.getSummaryStatKey(baseId, 'page')];
                });

                this.saveData();
                this.renderTable();
                this.updateDashboard();
            }
        } catch (e) {
            console.error("削除処理中にエラーが発生しました:", e);
            alert("削除処理中にエラーが発生しました: " + e.message);
        } finally {
            if (this.deleteConfirmModal) {
                this.deleteConfirmModal.classList.add('hidden');
            }
        }
    }

    loadNextPage() {
        if (this.isAutoGenerated) {
            alert('自動生成されたレビューモードでは次の問題へ進むことはできません。');
            return;
        }
        
        // Find current in flat list
        const getFlatDisplayList = (parentId = null) => {
            let result = [];
            const items = this.quizData.filter(item => (item.parentId || null) === parentId);
            items.forEach(item => {
                result.push(item);
                if (item.type === 'folder') {
                    result = result.concat(getFlatDisplayList(item.id));
                }
            });
            return result;
        };

        const flatList = getFlatDisplayList(null).filter(item => item.type !== 'folder');
        const currentIndex = flatList.findIndex(item => item.id === this.currentSetId);
        
        if (currentIndex !== -1 && currentIndex < flatList.length - 1) {
            const nextItem = flatList[currentIndex + 1];
            this.loadSet(nextItem.id);
            // Scroll sidebar to the next item
            setTimeout(() => {
                const activeLink = this.tocList.querySelector('a.active');
                if (activeLink) {
                    activeLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        } else {
            alert('最後の問題です。');
        }
    }

    cloneCurrentPage() {
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (!set || set.type === 'folder') return;
        const clonedSet = JSON.parse(JSON.stringify(set));
        const newId = 'p-' + Date.now();
        clonedSet.id = newId;
        clonedSet.title = clonedSet.title + '（コピー）';

        // Re-generate question IDs to avoid conflicts and start fresh stats
        clonedSet.questions.forEach((q, i) => {
            q.id = 'q-' + Date.now() + '-' + i + '-' + Math.random().toString(36).substr(2, 5);
        });

        this.quizData.push(clonedSet);
        this.saveData();
        this.isAutoGenerated = false;
        this.renderTOC();
        this.loadSet(newId);
    }

    updateAutoFillShortcutUI() {
        if (!this.autoFillShortcutBtn) return;
        const isActive = this.autoFillEnabled;
        this.autoFillShortcutBtn.classList.toggle('active', isActive);
        if (isActive) {
            this.autoFillShortcutBtn.style.background = 'var(--accent)';
            this.autoFillShortcutBtn.style.color = 'var(--bg-dark)';
            this.autoFillShortcutBtn.innerHTML = `✨ 自動入力: ${this.autoFillThreshold}回`;
        } else {
            this.autoFillShortcutBtn.style.background = 'rgba(76, 201, 240, 0.1)';
            this.autoFillShortcutBtn.style.color = 'var(--accent)';
            this.autoFillShortcutBtn.innerHTML = '✨ 自動入力: OFF';
        }
    }

    clearData() {
        const input = prompt('すべての学習データと履歴を完全に削除しますか？\n削除する場合は、確認のため「RESET」と入力してください。\n注：事前に「バックアップ保存」を行うことをお勧めします。');
        if (input === 'RESET') { localStorage.clear(); window.location.reload(); } else if (input !== null) { alert('入力が正しくないため、削除はキャンセルされました。'); }
    }

    // --- Data Management (Export/Import) ---

    getTimestamp() {
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    async exportToJSON() {
        const fullData = {
            quizData: this.quizData,
            history: this.history,
            questionStats: this.questionStats,
            exportedAt: new Date().toISOString()
        };
        const fileName = `sharo_study_backup_${this.getTimestamp()}.json`;
        const jsonContent = JSON.stringify(fullData, null, 2);

        // Try File System Access API for folder selection
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(jsonContent);
                await writable.close();
                this.updateDataStatus("JSONを保存しました。");
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error("showSaveFilePicker failed:", err);
            }
        }

        // Fallback for older browsers
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        this.updateDataStatus("JSON形式でエクスポートしました（ダウンロードフォルダに保存）。");
    }

    async exportToCSV() {
        // CSV is focused on quiz questions only (for spreadsheet editing)
        let csv = '\uFEFF'; // UTF-8 BOM
        csv += 'ページタイトル,ID,問題文,正解(カンマ区切り),解説,選択肢1,選択肢2,選択肢3,選択肢4,選択肢5,選択肢6,選択肢7,選択肢8,選択肢9,選択肢10\n';

        this.quizData.forEach(page => {
            if (page.type !== 'page' || !page.questions) return;
            page.questions.forEach(q => {
                const row = [
                    page.title,
                    q.id,
                    q.text,
                    Array.isArray(q.answer) ? q.answer.join('|') : q.answer,
                    q.memo || '',
                    ...(page.columns.slice(1)) // choice choices
                ].map(val => `"${(val || "").toString().replace(/"/g, '""')}"`).join(',');
                csv += row + '\n';
            });
        });

        const fileName = `sharo_questions_${this.getTimestamp()}.csv`;

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(csv);
                await writable.close();
                this.updateDataStatus("CSVを保存しました。");
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error("showSaveFilePicker failed:", err);
            }
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        this.updateDataStatus("CSV形式でエクスポートしました（ダウンロードフォルダに保存）。");
    }

    handleFileImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            if (file.name.endsWith('.json')) {
                this.importFromJSON(content);
            } else if (file.name.endsWith('.csv')) {
                this.importFromCSV(content);
            }
        };
        reader.readAsText(file);
    }

    async importFromJSON(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            
            const isBackup = !!data.quizData;
            const incomingQuizData = Array.isArray(data) ? data : data.quizData;
            
            if (!incomingQuizData || !Array.isArray(incomingQuizData)) {
                throw new Error('Invalid JSON format: missing quiz data array');
            }

            // Auto-convert depth to parentId for AI-generated flat arrays
            let currentParents = {};
            incomingQuizData.forEach(item => {
                // Ensure IDs exist
                if (!item.id) item.id = 'import_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                
                if (item.parentId === undefined && item.depth !== undefined) {
                    item.parentId = item.depth > 0 ? (currentParents[item.depth - 1] || null) : null;
                }
                if (item.type === 'folder') {
                    let d = item.depth;
                    if (d === undefined) {
                        let curr = item;
                        d = 0;
                        while (curr && curr.parentId) {
                            d++;
                            curr = incomingQuizData.find(x => x.id === curr.parentId);
                        }
                    }
                    currentParents[d] = item.id;
                }
            });

            if (isBackup) {
                if (confirm('現在のデータをすべて上書きして復元しますか？\n（現在の問題・履歴・統計がすべて消え、ファイルの内容に置き換わります）')) {
                    this.quizData = incomingQuizData;
                    this.history = data.history || [];
                    this.questionStats = data.questionStats || {};
                    await this.saveAll();
                    alert('データを正常に復元しました。');
                    window.location.reload();
                }
            } else {
                if (confirm('AI等で作成された問題データが検出されました。\n現在のデータに追加（マージ）しますか？')) {
                    // Prepend or append? Usually append.
                    this.quizData = [...this.quizData, ...incomingQuizData];
                    await this.saveAll();
                    alert('新しい問題を追加しました。');
                    window.location.reload();
                }
            }
        } catch (err) {
            console.error(err);
            alert('ファイルの読み込みに失敗しました。有効なJSONフォーマットであることを確認してください。');
        }
    }

    importFromCSV(csvString) {
        try {
            const lines = csvString.split(/\r?\n/);
            if (lines.length < 2) return;

            // Simple CSV parser (not handling all escapes, but works for standard export)
            const parseCSVLine = (line) => {
                const parts = [];
                let current = '';
                let inQuotes = false;
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
                    else if (char === '"') inQuotes = !inQuotes;
                    else if (char === ',' && !inQuotes) { parts.push(current); current = ''; }
                    else current += char;
                }
                parts.push(current);
                return parts;
            };

            const header = parseCSVLine(lines[0]);
            const newPages = new Map();

            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const row = parseCSVLine(lines[i]);
                const pageTitle = row[0];
                const id = row[1] || ('q-' + Math.random().toString(36).substr(2, 9));
                const text = row[2];
                const answerRaw = row[3];
                const choices = row.slice(4).filter(c => c !== undefined && c !== "");

                if (!pageTitle || !text) continue;

                if (!newPages.has(pageTitle)) {
                    newPages.set(pageTitle, {
                        id: 'p-' + Date.now() + Math.random().toString(36).substr(2, 5),
                        title: pageTitle,
                        type: 'page',
                        parentId: null,
                        isCollapsed: false,
                        columns: ["項目", ...choices],
                        questions: [],
                        isMultiSelect: answerRaw.includes('|')
                    });
                }

                const page = newPages.get(pageTitle);
                page.questions.push({
                    id: id,
                    text: text,
                    answer: page.isMultiSelect ? answerRaw.split('|') : answerRaw,
                    isInPool: true
                });
            }

            if (confirm(`CSVから ${newPages.size} ページの問題を取り込みますか？\n既存のページは維持され、末尾に追加されます。`)) {
                this.quizData.push(...Array.from(newPages.values()));
                this.saveData();
                alert('CSVからデータを正常に取り込みました。');
                this.renderTOC();
                this.loadSet(this.currentSetId);
            }
        } catch (err) {
            console.error(err);
            alert('CSVの解析に失敗しました。');
        }
    }

    updateDataStatus(msg) {
        if (this.dataStatusMsg) {
            this.dataStatusMsg.textContent = `${msg} (${new Date().toLocaleTimeString()})`;
            this.dataStatusMsg.style.color = 'var(--success)';
            setTimeout(() => {
                this.dataStatusMsg.style.color = 'var(--text-secondary)';
            }, 5000);
        }
        // Save export timestamp for reminder
        if (msg.includes("エクスポート")) {
            localStorage.setItem('sharo_last_export_at', new Date().toISOString());
            this.checkBackupFrequency();
        }
    }

    // --- Automatic Recovery and Protection ---

    async checkAndOfferRecovery(manual = false) {
        const backupStr = localStorage.getItem('sharo_auto_backup');
        if (!backupStr) {
            if (manual) alert('内部バックアップが見つかりません。');
            return;
        }

        try {
            const backup = JSON.parse(backupStr);
            const isMainEmpty = (this.quizData.length <= DEFAULT_QUIZ_DATA.length && this.history.length === 0);

            if (manual || isMainEmpty) {
                const date = new Date(backup.savedAt).toLocaleString();
                const msg = manual
                    ? `内部バックアップ（保存日時: ${date}）からデータを復元しますか？\n現在編集中の内容は上書きされます。`
                    : `【データ復旧の案内】\nメインデータが初期状態のようですが、内部バックアップ（保存日時: ${date}）が見つかりました。\n以前の状態を復元しますか？`;

                if (confirm(msg)) {
                    this.quizData = backup.quizData;
                    this.history = backup.history || [];
                    this.questionStats = backup.questionStats || {};
                    await this.saveAll();
                    alert('データを正常に復元しました。');
                    window.location.reload();
                }
            }
        } catch (e) {
            console.error("Backup parse error", e);
        }
    }

    checkBackupFrequency() {
        const lastExport = localStorage.getItem('sharo_last_export_at');
        if (!lastExport) return;

        const hoursSince = (Date.now() - new Date(lastExport).getTime()) / (1000 * 60 * 60);
        if (hoursSince > 24) {
            const reminderArea = document.getElementById('backup-reminder');
            if (reminderArea) {
                reminderArea.style.display = 'block';
                reminderArea.innerHTML = `⚠️ 最終エクスポートから24時間以上経過しています。大切なデータを守るため、<span style="color:var(--accent); cursor:pointer; text-decoration:underline;" onclick="app.exportToJSON()">JSONバックアップの保存</span>をお勧めします。`;
            }
        } else {
            const reminderArea = document.getElementById('backup-reminder');
            if (reminderArea) reminderArea.style.display = 'none';
        }
    }

    setupQuestionObserver() {
        if (this.questionObserver) this.questionObserver.disconnect();

        const options = {
            root: null,
            rootMargin: '-5% 0px -20% 0px',
            threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
        };

        this.questionObserver = new IntersectionObserver(() => {
            this.activateFirstVisibleBank();
        }, options);

        const targets = document.querySelectorAll('#quiz-table tr, .auto-gen-table tr');
        targets.forEach(t => {
            if (t.dataset.keywords) {
                this.questionObserver.observe(t);
            }
        });

        // Fallback: also update on scroll for smoother experience
        if (this._scrollHandler) window.removeEventListener('scroll', this._scrollHandler);
        this._scrollHandler = () => this.activateFirstVisibleBank();
        window.addEventListener('scroll', this._scrollHandler, { passive: true });

        this.activateFirstVisibleBank();
        setTimeout(() => this.activateFirstVisibleBank(), 300);
    }

    activateFirstVisibleBank() {
        if (this.isEditMode || this.isChecked) {
            if (this.globalKeywordBank) {
                this.globalKeywordBank.classList.add('hidden');
                this.globalKeywordBank.classList.remove('active-bank');
            }
            this._currentActiveRowId = null;
            return;
        }

        const targets = Array.from(document.querySelectorAll('#quiz-table tr, .auto-gen-table tr')).filter(r => r.dataset.keywords);

        const isSingleClause = !this.clauseDisplay.classList.contains('hidden');
        const isHome = this.homeDashboard && !this.homeDashboard.classList.contains('hidden');

        if (targets.length === 0) {
            if (!isSingleClause || isHome) {
                if (this.globalKeywordBank) {
                    this.globalKeywordBank.classList.add('hidden');
                    this.globalKeywordBank.classList.remove('active-bank');
                }
                this._currentActiveRowId = null;
            }
            return;
        }

        // 画面上部から40%の位置を「切り替えの閾値」とする
        const focusThreshold = window.innerHeight * 0.4;
        let bestRow = null;

        // ビューポート内にあるターゲットを取得
        const visibleTargets = targets.filter(tr => {
            const rect = tr.getBoundingClientRect();
            return rect.top < window.innerHeight && rect.bottom > 0;
        });

        if (visibleTargets.length > 0) {
            // 「現在の行」の底辺が閾値より下にある限り、その行を優先する（上から順に探す）
            bestRow = visibleTargets.find(tr => {
                const rect = tr.getBoundingClientRect();
                return rect.bottom > focusThreshold;
            });

            // すべてが閾値より上に行った場合は、一番下の可視行を選択
            if (!bestRow) bestRow = visibleTargets[visibleTargets.length - 1];
        }

        // 選択された行があっても、画面外（極端に下など）すぎる場合は非表示
        if (bestRow) {
            const rect = bestRow.getBoundingClientRect();
            if (rect.top > window.innerHeight * 0.9) bestRow = null;
        }

        if (bestRow) {
            if (this._currentActiveRowId !== bestRow.id) {
                this._currentActiveRowId = bestRow.id;
                this.updateGlobalKeywordBank(bestRow);
            }
        } else {
            if (this._currentActiveRowId !== null) {
                this._currentActiveRowId = null;
                if (this.globalKeywordBank) {
                    this.globalKeywordBank.classList.add('hidden');
                    this.globalKeywordBank.classList.remove('active-bank');
                }
            }
        }
    }

    updateGlobalKeywordBank(row) {
        if (!this.globalKeywordBank) return;

        // Hide bank if we are in "isChecked" mode or Edit mode
        if (this.isChecked || this.isEditMode || !row || !row.dataset.keywords) {
            this.globalKeywordBank.classList.add('hidden');
            this.globalKeywordBank.classList.remove('active-bank');
            this._currentActiveRowId = null;
            return;
        }

        const qid = row.dataset.qid;
        const allOptions = JSON.parse(row.dataset.keywords);
        const requiredCounts = JSON.parse(row.dataset.requiredCounts);

        const cacheKey = `bank-${qid}`;
        if (!this.shuffledCache[cacheKey]) {
            let optionsToDisplay = allOptions;
            if (allOptions.length > this.MAX_DISPLAYED_CHOICES) {
                const shuffledSet = [...allOptions].sort(() => Math.random() - 0.5);
                optionsToDisplay = shuffledSet.slice(0, this.MAX_DISPLAYED_CHOICES);
                // Trigger auto-fill for this subset
                this.applyAutoFillForHiddenChoices(qid, optionsToDisplay);
            }
            this.shuffledCache[cacheKey] = optionsToDisplay.sort(() => Math.random() - 0.5);
        }

        const usedCounts = {};
        Object.keys(this.userAnswers).forEach(key => {
            if (key.startsWith(`${qid}-`)) {
                const ans = this.userAnswers[key];
                usedCounts[ans] = (usedCounts[ans] || 0) + 1;
            }
        });
        const topAns = this.userAnswers[qid];
        if (topAns) {
            if (Array.isArray(topAns)) topAns.forEach(a => usedCounts[a] = (usedCounts[a] || 0) + 1);
            else usedCounts[topAns] = (usedCounts[topAns] || 0) + 1;
        }

        this.globalKeywordBank.innerHTML = '';
        this.globalKeywordBank.classList.remove('hidden');
        this.globalKeywordBank.classList.add('active-bank');
        this.globalKeywordBank.classList.toggle('minimized', this.isBankMinimized);

        // Add Header for minimization
        const bankHeader = document.createElement('div');
        bankHeader.className = 'keyword-bank-header';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'bank-title';
        titleSpan.textContent = this.isBankMinimized ? '選択肢バンク (最小化中)' : '選択肢バンク';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'bank-toggle-btn';
        toggleBtn.textContent = this.isBankMinimized ? '▲ 展開する' : '▼ 最小化する';
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            this.isBankMinimized = !this.isBankMinimized;
            this.updateGlobalKeywordBank(row);
        };

        bankHeader.appendChild(titleSpan);
        bankHeader.appendChild(toggleBtn);
        this.globalKeywordBank.appendChild(bankHeader);

        if (this.isBankMinimized) return;

        this.shuffledCache[cacheKey].forEach(word => {
            const req = requiredCounts[word] || 0;
            const used = usedCounts[word] || 0;
            const isUsed = req > 0 ? (used >= req) : (used > 0);

            const card = document.createElement('div'); card.className = `keyword-card ${isUsed ? 'used' : ''}`;
            if (req > 1 && !isUsed) {
                card.innerHTML = `${word} <span class="keyword-count-badge">${req - used}</span>`;
            } else {
                card.textContent = word;
            }
            if (this.selectedKeyword === word) card.classList.add('selected');

            card.draggable = !isUsed;
            card.onclick = (e) => {
                if (isUsed) return;
                if (this.selectedKeyword === word) {
                    this.selectedKeyword = null;
                } else {
                    this.selectedKeyword = word;
                }
                this.updateGlobalKeywordBank(row);
            };
            card.ondragstart = (e) => {
                if (isUsed) return;
                e.dataTransfer.setData('text/plain', word);
                card.classList.add('dragging');
                // Store active qid globally for drop handling if needed
                this.activeDragQid = qid;
            };
            card.ondragend = () => card.classList.remove('dragging');
            this.globalKeywordBank.appendChild(card);
        });
    }

    mergeStats(local, remote) {
        const merged = JSON.parse(JSON.stringify(remote));
        for (const [key, lStat] of Object.entries(local)) {
            if (!merged[key]) {
                merged[key] = lStat;
            } else {
                const rStat = merged[key];
                if (lStat.history && rStat.history) {
                    const combined = [...lStat.history, ...rStat.history];
                    const unique = [];
                    const seen = new Set();
                    combined.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(h => {
                        if (!seen.has(h.date)) {
                            unique.push(h); seen.add(h.date);
                        }
                    });
                    rStat.history = unique.slice(0, 50);
                    rStat.total = unique.length;
                    rStat.correct = unique.filter(h => h.isCorrect).length;
                } else {
                    if ((lStat.total || 0) > (rStat.total || 0)) {
                        rStat.total = lStat.total;
                        rStat.correct = lStat.correct;
                        if (lStat.recent) rStat.recent = lStat.recent;
                    }
                }
                if (lStat.nextReview && (!rStat.nextReview || new Date(lStat.nextReview) > new Date(rStat.nextReview))) {
                    rStat.nextReview = lStat.nextReview;
                    rStat.srsLevel = lStat.srsLevel;
                }
            }
        }
        return merged;
    }

    mergeHistory(local, remote) {
        const combined = [...local, ...remote];
        const unique = [];
        const seen = new Set();
        combined.sort((a, b) => new Date(b.isoDate || 0) - new Date(a.isoDate || 0)).forEach(h => {
            const key = (h.isoDate || h.timestamp) + h.pageId;
            if (!seen.has(key)) {
                unique.push(h); seen.add(key);
            }
        });
        return unique.slice(0, 50);
    }

    async syncWithGitHub() {
        const config = JSON.parse(localStorage.getItem('sharoGitHubConfig') || '{}');
        if (!config.token || !config.repo) {
            alert('GitHubの設定（トークンとリポジトリ）を先に保存してください。');
            return;
        }

        const forceRepaint = () => new Promise(resolve => setTimeout(resolve, 100));
        if (this.ghSyncNowBtn) { this.ghSyncNowBtn.disabled = true; this.ghSyncNowBtn.textContent = '同期中...'; }
        if (this.sidebarGhSyncBtn) { this.sidebarGhSyncBtn.disabled = true; this.sidebarGhSyncBtn.textContent = '同期中...'; }
        this.updateGitHubStatus('同期中...');

        try {
            // Pre-sync backup
            const backupData = { quizData: this.quizData, questionStats: this.questionStats, history: this.history };
            await window.idbSet('sharoBackupBeforeSync', { data: backupData, date: Date.now() });

            this.updateGitHubStatus('データをダウンロード中...');
            await forceRepaint();
            const remote = await this.fetchFromGitHub(config);
            
            const lastSyncModified = parseInt(localStorage.getItem('sharoLastSyncModified') || '0');
            const localModified = parseInt(localStorage.getItem('sharoLastModified') || '0');
            const localData = { quizData: this.quizData, questionStats: this.questionStats, history: this.history, lastModified: localModified };

            if (!remote) {
                // First time sync: just push
                this.updateGitHubStatus('初回同期（アップロード中）...');
                localData.lastModified = Date.now();
                await this.pushToGitHub(config, localData, forceRepaint);
                localStorage.setItem('sharoLastSyncModified', localData.lastModified);
                localStorage.setItem('sharoLastModified', localData.lastModified);
                this.updateGitHubStatus(`同期完了 (${new Date().toLocaleTimeString()})`);
                alert('初回同期が完了しました。');
                return;
            }

            const remoteModified = remote.lastModified || 0;
            const hasRemoteChanged = remoteModified > lastSyncModified;
            const hasLocalChanged = localModified > lastSyncModified;

            if (hasRemoteChanged && hasLocalChanged) {
                // CONFLICT
                const choice = confirm(`【競合】GitHubとローカルの両方に新しい変更があります。\n\n・OK: データを統合して同期（推奨）\n・キャンセル: 今回は中断`);
                if (!choice) {
                    this.updateGitHubStatus('同期中断');
                    return;
                }
                this.updateGitHubStatus('データを統合中...');
                await forceRepaint();
                this.questionStats = this.mergeStats(this.questionStats, remote.questionStats || {});
                this.history = this.mergeHistory(this.history, remote.history || []);
                // quizData merging is complex; for now strictly latest wins
                if (remoteModified > localModified) this.quizData = remote.quizData;
                
                const mergedData = { quizData: this.quizData, questionStats: this.questionStats, history: this.history, lastModified: Date.now() };
                await this.pushToGitHub(config, mergedData, forceRepaint);
                await this.saveAll();
                localStorage.setItem('sharoLastSyncModified', mergedData.lastModified);
                localStorage.setItem('sharoLastModified', mergedData.lastModified);
                alert('データの統合と同期が完了しました。');
                location.reload();
                return;
            } else if (hasRemoteChanged) {
                // Remote is newer, local hasn't changed since last sync
                if (confirm(`GitHub上に新しいデータがあります（${new Date(remoteModified).toLocaleString()}）。読み込みますか？`)) {
                    this.quizData = remote.quizData;
                    this.questionStats = remote.questionStats;
                    this.history = remote.history;
                    await this.saveAll();
                    localStorage.setItem('sharoLastSyncModified', remoteModified);
                    localStorage.setItem('sharoLastModified', remoteModified);
                    alert('リモートのデータを読み込みました。');
                    location.reload();
                    return;
                }
            } else if (hasLocalChanged || remoteModified !== localModified) {
                // Local is newer or timestamps differ for other reasons: push local
                this.updateGitHubStatus('アップデートを送信中...');
                localData.lastModified = Date.now();
                await this.pushToGitHub(config, localData, forceRepaint);
                localStorage.setItem('sharoLastSyncModified', localData.lastModified);
                localStorage.setItem('sharoLastModified', localData.lastModified);
                this.updateGitHubStatus(`同期完了 (${new Date().toLocaleTimeString()})`);
                alert('最新の記録をクラウドに保存しました。');
            } else {
                this.updateGitHubStatus('データは最新です');
                alert('データは既に最新の状態です。');
            }
        } catch (error) {
            console.error('Sync error:', error);
            alert('同期に失敗しました: ' + error.message);
            this.updateGitHubStatus('同期失敗');
        } finally {
            if (this.ghSyncNowBtn) { this.ghSyncNowBtn.disabled = false; this.ghSyncNowBtn.textContent = '今すぐ同期（アップロード＆ダウンロード）'; }
            if (this.sidebarGhSyncBtn) { this.sidebarGhSyncBtn.disabled = false; this.sidebarGhSyncBtn.textContent = '今すぐ同期'; }
        }
    }

    applyAutoFillForHiddenChoices(qid, visibleChoices) {
        const visibleSet = new Set(visibleChoices);
        const set = this.isAutoGenerated ? this.autoGeneratedSet : this.quizData.find(s => s.id === this.currentSetId);
        if (!set) return;

        let question = null;
        if (set.type === 'clause' && set.id === qid) {
            question = set;
        } else if (set.questions) {
            question = set.questions.find(q => q.id === qid);
        }

        if (!question) return;

        let changed = false;
        if (question.type === 'clause' || /\[\[|［［|\(\(|（（/.test(question.text || '')) {
            const keywords = this.extractKeywords(question.text);
            keywords.forEach((kw, idx) => {
                const key = `${qid}-${idx}`;
                // Only auto-fill if it's a "drag" keyword that was hidden from the bank.
                // Numerical inputs (type: 'input') are never part of the bank and should not be auto-filled.
                if (kw.type === 'drag' && !visibleSet.has(kw.text)) {
                    if (!this.userAnswers[key]) {
                        this.userAnswers[key] = kw.text;
                        this.autoFilledAnswers.add(key);
                        changed = true;
                    }
                }
            });
        } else {
            const isQMulti = this.isAutoGenerated ? question.isMultiSelect : set.isMultiSelect;
            if (isQMulti && Array.isArray(question.answer)) {
                const hiddenAnswers = question.answer.filter(a => !visibleSet.has(a));
                if (hiddenAnswers.length > 0) {
                    if (!Array.isArray(this.userAnswers[qid])) this.userAnswers[qid] = [];
                    hiddenAnswers.forEach(a => {
                        if (!this.userAnswers[qid].includes(a)) {
                            this.userAnswers[qid].push(a);
                            changed = true;
                        }
                    });
                    if (changed) this.autoFilledAnswers.add(qid);
                }
            } else if (!visibleSet.has(question.answer)) {
                if (!this.userAnswers[qid]) {
                    this.userAnswers[qid] = question.answer;
                    this.autoFilledAnswers.add(qid);
                    changed = true;
                }
            }
        }

        if (changed) {
            this.saveAutoFilledAnswers();
            setTimeout(() => {
                if (set.type === 'clause') this.renderClauseView(set);
                else this.renderTable();
            }, 0);
        }
    }

    // --- GitHub Sync Methods ---

    loadGitHubConfig() {
        const config = JSON.parse(localStorage.getItem('sharoGitHubConfig') || '{}');
        if (this.ghTokenInput) this.ghTokenInput.value = config.token || '';
        if (this.ghRepoInput) this.ghRepoInput.value = config.repo || '';
        if (this.ghPathInput) this.ghPathInput.value = config.path || 'data/sharo_study_sync.json';
        this.updateGitHubStatus();
    }

    saveGitHubConfig() {
        const config = {
            token: this.ghTokenInput.value.trim(),
            repo: this.ghRepoInput.value.trim(),
            path: this.ghPathInput.value.trim()
        };
        localStorage.setItem('sharoGitHubConfig', JSON.stringify(config));
        alert('GitHubの設定を保存しました。');
        this.updateGitHubStatus();
    }

    updateGitHubStatus(msg = null) {
        if (!this.ghSyncStatus) return;
        const config = JSON.parse(localStorage.getItem('sharoGitHubConfig') || '{}');
        if (!config.token || !config.repo) {
            this.ghSyncStatus.textContent = '未連携';
            this.ghSyncStatus.className = 'github-connect-status';
            return;
        }
        this.ghSyncStatus.textContent = msg || '連携済み（同期ボタンを押してください）';
        this.ghSyncStatus.className = 'github-connect-status synced';
    }


    async fetchFromGitHub(config) {
        const url = `https://api.github.com/repos/${config.repo}/contents/${config.path}`;
        const headers = {
            'Authorization': config.token.startsWith('ghp_') ? `token ${config.token}` : `Bearer ${config.token}`
        };

        // 1. Get SHA via HEAD request (bypasses 1MB body limit)
        const headResponse = await fetch(url, { method: 'HEAD', headers });
        if (headResponse.status === 404) return null;
        if (!headResponse.ok) throw new Error(`Metadata check failed: ${headResponse.status}`);

        // GitHub ETag for blobs/contents is the SHA
        const etag = headResponse.headers.get('ETag');
        this._ghFileSha = etag ? etag.replace(/"/g, '') : null;

        // 2. Fetch content via Raw media type (handles up to 100MB)
        const rawResponse = await fetch(url, {
            headers: { ...headers, 'Accept': 'application/vnd.github.v3.raw' }
        });

        if (!rawResponse.ok) {
            throw new Error(`Content fetch failed: ${rawResponse.status}`);
        }

        const content = await rawResponse.text();
        if (!content) return null;

        try {
            return JSON.parse(content);
        } catch (e) {
            console.error('JSON Parse Error. Raw content start:', content.substring(0, 100));
            throw new Error('リモートのJSONファイルが壊れているか、空です。');
        }
    }

    async pushToGitHub(config, data, forceRepaint = async () => {}) {
        this.pruneData();
        const url = `https://api.github.com/repos/${config.repo}/contents/${config.path}`;
        
        this.updateGitHubStatus('データをエンコード中 (数秒かかる場合があります)...');
        await forceRepaint();
        const content = await this.utf8_to_b64_encode(JSON.stringify(data));

        this.updateGitHubStatus('GitHubへアップロード中...');
        await forceRepaint();
        // Need current SHA to update existing file
        if (!this._ghFileSha) {
            const headResponse = await fetch(url, {
                method: 'HEAD',
                headers: { 'Authorization': config.token.startsWith('ghp_') ? `token ${config.token}` : `Bearer ${config.token}` }
            });
            if (headResponse.ok) {
                const etag = headResponse.headers.get('ETag');
                this._ghFileSha = etag ? etag.replace(/"/g, '') : null;
            }
        }

        const body = {
            message: 'Sync sharo study data',
            content: content,
            sha: this._ghFileSha
        };

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': config.token.startsWith('ghp_') ? `token ${config.token}` : `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Push failed');
        }

        const resData = await response.json();
        this._ghFileSha = resData.content.sha;
    }

    // Helper for Unicode-safe Base64 that prevents memory crashes on iOS
    async utf8_to_b64_encode(str) {
        return new Promise((resolve, reject) => {
            const blob = new Blob([str], { type: 'application/json' });
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const base64 = dataUrl.split(',')[1];
                resolve(base64);
            };
            reader.onerror = error => reject(error);
            reader.readAsDataURL(blob);
        });
    }

    // --- Law Article Drill Methods ---

    formatEGovAnchor(anchor) {
        if (!anchor) return "全体";
        let text = "";
        
        if (anchor.startsWith('Sp')) {
            text += "附則 ";
        }
        
        const atMatch = anchor.match(/At_([\d_]+)/);
        if (atMatch) {
            const parts = atMatch[1].split('_');
            text += `第${parts[0]}条`;
            if (parts.length > 1) text += `の${parts.slice(1).join('の')}`;
        }
        const prMatch = anchor.match(/Pr_([\d_]+)/);
        if (prMatch) {
            const parts = prMatch[1].split('_');
            text += `第${parts[0]}項`;
            if (parts.length > 1) text += `の${parts.slice(1).join('の')}`;
        }
        const itMatch = anchor.match(/It_([\d_]+)/);
        if (itMatch) {
            const parts = itMatch[1].split('_');
            text += `第${parts[0]}号`;
            if (parts.length > 1) text += `の${parts.slice(1).join('の')}`;
        }
        return text || anchor;
    }

    function getMappedLawId(lawId, anchor);

            // Fetch XML from e-Gov API
            const apiUrl = `https://laws.e-gov.go.jp/api/1/lawdata/${fetchLawId}`;
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error("APIレスポンスエラー: " + response.status);
            const xmlText = await response.text();
            
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            
            // Get Law Name
            const lawNameEl = xmlDoc.querySelector("LawTitle") || xmlDoc.querySelector("LawName");
            if (lawNameEl && fetchLawId === lawId) {
                titleEl.textContent = lawNameEl.textContent;
            } else {
                titleEl.textContent = this.getKnownLawName(lawId);
            }

            // Find target element by anchor
            let targetNode = null;
            
            const findArticleInList = (articleList, targetNumStr) => {
                for (let i = 0; i < articleList.length; i++) {
                    const num = articleList[i].getAttribute("Num");
                    if (num === targetNumStr) return articleList[i];
                    if (num && num.includes(':')) {
                        const parts = num.split(':');
                        const s = parseInt(parts[0]);
                        const e = parseInt(parts[1]);
                        const t = parseInt(targetNumStr);
                        if (!isNaN(s) && !isNaN(e) && !isNaN(t) && t >= s && t <= e) {
                            return articleList[i];
                        }
                    }
                }
                return null;
            };

            if (anchor.startsWith('Mp-At_')) {
                // Main Provision - Article
                const articleNum = anchor.replace('Mp-At_', '');
                const articles = xmlDoc.querySelectorAll("Article");
                targetNode = findArticleInList(articles, articleNum);
            } else if (anchor.startsWith('Sp')) {
                // Supplementary Provisions
                const amendMatch = anchor.match(/^Sp_?(.*?)(?:[-_]At_|$)/);
                const rawAmendNum = amendMatch && amendMatch[1] ? amendMatch[1] : null;
                let amendNum = rawAmendNum ? decodeURIComponent(rawAmendNum) : null;
                
                // Fallback for AI hallucinated anchors that lack the AmendLawNum (e.g. #Sp-At_47)
                if (!amendNum && lawId !== fetchLawId) {
                    const AMEND_NUM_MAP = {
                        "412AC0000000018": "平成一二年三月三一日法律第一八号",
                        "416AC0000000104": "平成一六年六月一一日法律第一〇四号",
                        "360AC0000000034": "昭和六〇年五月一日法律第三四号",
                        "406AC0000000095": "平成六年一一月九日法律第九五号",
                        "424AC0000000063": "平成二四年八月二二日法律第六三号"
                    };
                    amendNum = AMEND_NUM_MAP[lawId] || null;
                }
                
                let targetSp = null;
                const spNodes = xmlDoc.querySelectorAll("SupplProvision");
                
                // 1. Exact match
                for (let i = 0; i < spNodes.length; i++) {
                    if (!amendNum && !spNodes[i].hasAttribute("AmendLawNum")) {
                        targetSp = spNodes[i]; break;
                    }
                    if (amendNum && spNodes[i].getAttribute("AmendLawNum") === amendNum) {
                        targetSp = spNodes[i]; break;
                    }
                }
                
                // 2. Fuzzy match (handle e-Gov kanji inconsistencies like 三十四 vs 三四)
                if (!targetSp && amendNum) {
                    const fuzzyAmend = amendNum.replace(/十/g, '');
                    for (let i = 0; i < spNodes.length; i++) {
                        const nodeAmend = spNodes[i].getAttribute("AmendLawNum") || "";
                        if (nodeAmend && nodeAmend.replace(/十/g, '') === fuzzyAmend) {
                            targetSp = spNodes[i]; break;
                        }
                    }
                }
                
                // 3. Ultimate fallback for original law (which lacks AmendLawNum in XML despite URL having one)
                if (!targetSp && spNodes.length > 0 && !spNodes[0].hasAttribute("AmendLawNum")) {
                    targetSp = spNodes[0];
                }
                
                if (targetSp) {
                    // Check for both -At_ and _At_ for robustness against AI hallucinations
                    const atMatch = anchor.match(/[-_]At_([0-9_]+)/);
                    if (atMatch) {
                        const spArticles = targetSp.querySelectorAll("Article");
                        targetNode = findArticleInList(spArticles, atMatch[1]);
                    }
                    if (!targetNode) targetNode = targetSp; // fallback to whole SupplProvision
                }
            } else if (anchor.startsWith('Ap')) {
                // AppdxTable (別表)
                const numStr = anchor.replace(/^A[pP]+_?/, ''); 
                const appdxTables = xmlDoc.querySelectorAll("AppdxTable");
                for (let i = 0; i < appdxTables.length; i++) {
                    const titleEl = appdxTables[i].querySelector("AppdxTableTitle");
                    if (titleEl) {
                        let titleText = titleEl.textContent;
                        titleText = titleText.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
                        titleText = titleText.replace('の', '_');
                        const tMatch = titleText.match(/別表第?([0-9_]+)/);
                        if (tMatch && tMatch[1] === numStr) {
                            targetNode = appdxTables[i];
                            break;
                        }
                    }
                }
            }

            if (!targetNode) {
                // If it's a general law link or unsupported anchor, just show the first article or a message
                const firstArticle = xmlDoc.querySelector("Article");
                if (firstArticle) {
                    targetNode = firstArticle;
                    titleEl.textContent += " (先頭部分)";
                }
            }

            if (!targetNode) {
                contentArea.innerHTML = '<div style="color:var(--error);">指定された条文が見つかりませんでした。お手数ですが「別タブで開く」から公式ページをご確認ください。</div>';
            } else {
                // Simple recursive XML to HTML converter for e-Gov standard tags
                const parseEGovNode = (node) => {
                    let html = '';
                    if (node.nodeType === Node.TEXT_NODE) {
                        return node.textContent;
                    }
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        switch (node.tagName) {
                            case 'ArticleCaption':
                                html += `<div class="egov-caption">【${node.textContent}】</div>`;
                                break;
                            case 'ArticleTitle':
                                html += `<div class="egov-title">${node.textContent}</div>`;
                                break;
                            case 'Paragraph':
                                html += `<div class="egov-paragraph">`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</div>`;
                                break;
                            case 'ParagraphNum':
                                html += `<span style="margin-right: 0.5rem; font-weight: bold;">${node.textContent || ''}</span>`;
                                break;
                            case 'Item':
                                html += `<div class="egov-item">`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</div>`;
                                break;
                            case 'ItemTitle':
                                html += `<span style="margin-right: 0.5rem; font-weight: bold;">${node.textContent}</span>`;
                                break;
                            case 'Sentence':
                            case 'ParagraphSentence':
                            case 'ItemSentence':
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                break;
                            case 'Table':
                                html += `<div style="overflow-x: auto;"><table border="1" style="border-collapse: collapse; margin-top: 1rem; width: 100%; font-size: 0.9em; min-width: 400px;">`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</table></div>`;
                                break;
                            case 'TableRow':
                                html += `<tr>`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</tr>`;
                                break;
                            case 'TableColumn':
                                html += `<td style="padding: 0.5rem; border: 1px solid #ccc; vertical-align: top;">`;
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                html += `</td>`;
                                break;
                            case 'AppdxTableTitle':
                                html += `<div class="egov-title" style="margin-top: 1rem; font-size: 1.2em; font-weight: bold;">${node.textContent}</div>`;
                                break;
                            case 'TableStructTitle':
                                html += `<div style="font-weight: bold; margin-top: 0.5rem;">${node.textContent}</div>`;
                                break;
                            default:
                                Array.from(node.childNodes).forEach(child => html += parseEGovNode(child));
                                break;
                        }
                    }
                    return html;
                };

                contentArea.innerHTML = parseEGovNode(targetNode);
            }
        } catch (error) {
            console.error("e-Gov API fetch error:", error);
            contentArea.innerHTML = `<div style="color:var(--error);">データの取得に失敗しました。<br>お手数ですが右下の「別タブで開く」ボタンからご確認ください。<br><small>${error.message}</small></div>`;
        } finally {
            loadingArea.style.display = 'none';
            contentArea.style.display = 'block';
        }
    }

    deleteRow(id) {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (set.questions.length <= 1) { alert('最低1行は必要です。'); return; }
        if (confirm('この行を削除しますか？')) {
            set.questions = set.questions.filter(q => q.id !== id);
            this.saveData(); this.renderTable();
        }
    }

    moveRow(id, direction) {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        const index = set.questions.findIndex(q => q.id === id);
        if (index === -1) return;

        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= set.questions.length) return;

        // Swap
        const temp = set.questions[index];
        set.questions[index] = set.questions[newIndex];
        set.questions[newIndex] = temp;

        this.saveData();
        this.renderTable();
    }

    deleteColumn(index) {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (set.columns.length <= 2) { alert('最低1つの選択肢は必要です。'); return; }
        const colName = set.columns[index];
        if (confirm(`列「${colName}」を削除しますか？`)) {
            set.columns.splice(index, 1);
            set.questions.forEach(q => {
                if (Array.isArray(q.answer)) q.answer = q.answer.filter(a => a !== colName);
                else if (q.answer === colName) q.answer = set.columns[1];
            });
            this.saveData(); this.renderTable();
        }
    }

    formatDateStr(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    getDueCountMap() {
        const now = new Date();
        const todayStr = this.formatDateStr(now);
        const counts = {};

        // Get filter from dashboard if available
        const todayFilter = this.todayMasterySelect ? this.todayMasterySelect.value : 'all';

        const inPoolSets = new Set();
        const qToSet = new Map();
        this.quizData.forEach(set => {
            if (set.isInPool !== false) inPoolSets.add(set.id);
            if (set.questions) set.questions.forEach(q => qToSet.set(q.id, set.id));
        });

        const isStatInActivePool = (key) => {
            if (key.startsWith('clause-summary-')) return inPoolSets.has(key.replace('clause-summary-', ''));
            if (qToSet.has(key)) return inPoolSets.has(qToSet.get(key));
            return inPoolSets.has(key);
        };

        // Add completely new (Lv0) items to counts
        this.quizData.forEach(set => {
            if (set.isInPool === false) return;
            if (set.type === 'clause') {
                const summaryId = `clause-summary-${set.id}`;
                if (!this.questionStats[summaryId]) {
                    counts[set.id] = (counts[set.id] || 0) + 1;
                }
            } else if (set.type === 'page' && set.questions) {
                set.questions.forEach(q => {
                    if (!this.questionStats[q.id]) {
                        counts[set.id] = (counts[set.id] || 0) + 1;
                    }
                });
            }
        });

        Object.entries(this.questionStats).forEach(([key, s]) => {
            if (!s.nextReview || !isStatInActivePool(key)) return;
            if (key.startsWith('clause-') && !key.startsWith('clause-summary-')) return;
            
            if (this.formatDateStr(new Date(s.nextReview)) <= todayStr) {
                // Apply mastery filter
                if (!this.checkMasteryFilter(s.srsLevel || 0, todayFilter)) return;

                let itemId = s.pageId;
                if (!itemId) {
                    if (key.startsWith('clause-summary-')) itemId = key.replace('clause-summary-', '');
                    else itemId = key;
                }
                counts[itemId] = (counts[itemId] || 0) + 1;
            }
        });
        return counts;
    }

    calculateAllDueCounts() {
        const itemDueMap = this.getDueCountMap();
        const allDueCounts = {};
        
        const childrenMap = {};
        this.quizData.forEach(item => {
            const pid = item.parentId || 'root';
            if (!childrenMap[pid]) childrenMap[pid] = [];
            childrenMap[pid].push(item);
        });

        const walk = (parentId) => {
            let total = 0;
            const children = childrenMap[parentId || 'root'] || [];
            children.forEach(item => {
                if (item.type === 'folder') {
                    total += walk(item.id);
                } else {
                    total += (itemDueMap[item.id] || 0);
                }
            });
            if (parentId) allDueCounts[parentId] = total;
            return total;
        };

        walk(null);
        return { itemDueMap, allDueCounts };
    }

    renderTOC() {
        // Build a flat list in order of display (DFS)
        const getFlatDisplayList = (parentId = null, depth = 0) => {
            let result = [];
            const items = this.quizData.filter(item => (item.parentId || null) === parentId);
            items.forEach(item => {
                const globalIndex = this.quizData.findIndex(d => d.id === item.id);
                result.push({ ...item, depth, globalIndex });
                if (item.type === 'folder' && !item.isCollapsed) {
                    result = result.concat(getFlatDisplayList(item.id, depth + 1));
                }
            });
            return result;
        };

        const list = getFlatDisplayList(null, 0);
        const { itemDueMap, allDueCounts } = this.calculateAllDueCounts();

        this.tocList.innerHTML = list.map(s => {
            const isFolder = s.type === 'folder';
            const isActive = s.id === this.currentSetId && !this.isAutoGenerated && !isFolder;
            const indent = s.depth * 15;

            return `
            <li class="${isActive ? 'active' : ''} ${isFolder ? 'type-folder' : 'type-page'}" 
                style="padding-left: ${indent}px"
                draggable="${this.isEditMode}" 
                oncontextmenu="app.showContextMenu(event, '${s.id}')"
                ondragstart="app.handleDragStart(event, '${s.id}')" 
                ondragover="app.handleDragOver(event, '${s.id}')" 
                ondrop="app.handleDrop(event, '${s.id}')" 
                ondragend="app.handleDragEnd(event)">
                <div class="item-container ${isFolder ? 'folder-item' : ''}">
                    ${isFolder ? `
                        <span class="folder-toggle" onclick="event.stopPropagation(); app.toggleFolder('${s.id}')">
                            ${s.isCollapsed ? '▶' : '▼'}
                        </span>
                        <span class="folder-icon">${s.isCollapsed ? '📁' : '📂'}</span>
                    ` : ''}
                    ${this.isEditMode ? `<input type="checkbox" class="toc-delete-checkbox" data-id="${s.id}" title="削除対象として選択" onclick="event.stopPropagation();" style="accent-color: #e63946; margin-right: 4px; cursor: pointer;">` : ''}
                    <input type="checkbox" class="toc-pool-checkbox" 
                           ${s.isInPool ? 'checked' : ''} 
                           onclick="event.stopPropagation(); app.toggleItemPool('${s.id}')" 
                           title="特訓対象に含める">
                    <a href="#${s.id}" draggable="false" onclick="if('${isFolder}' === 'true') { event.preventDefault(); app.toggleFolder('${s.id}'); }">
                        ${s.title}
                    </a>
                    ${(isFolder && allDueCounts[s.id] > 0) ? `<span class="folder-due-badge" title="本日の復習待ち">${allDueCounts[s.id]}</span>` : ''}
                    ${(!isFolder && itemDueMap[s.id] > 0) ? `<span class="folder-due-badge" title="本日の復習待ち">${itemDueMap[s.id]}</span>` : ''}
                    <div class="reorder-btns">
                        <button class="reorder-btn" onclick="event.stopPropagation(); app.movePageById('${s.id}', -1)">▲</button>
                        <button class="reorder-btn" onclick="event.stopPropagation(); app.movePageById('${s.id}', 1)">▼</button>
                        ${isFolder ? `
                            <button class="reorder-btn" title="子フォルダを追加" onclick="event.stopPropagation(); app.addNewFolder('${s.id}')">＋📁</button>
                            <button class="reorder-btn" title="通常ページを追加" onclick="event.stopPropagation(); app.addNewPage('${s.id}')">＋📄</button>
                            <button class="reorder-btn" title="条文穴埋めを追加" onclick="event.stopPropagation(); app.addNewClausePage('${s.id}')">＋🔤</button>
                            <button class="reorder-btn delete-folder-btn" onclick="event.stopPropagation(); app.deleteFolder('${s.id}')">×</button>
                        ` : ''}
                    </div>
                </div>
            </li>`;
        }).join('');
    }

    handleDragStart(e, id) {
        if (!this.isEditMode) return;
        this.draggedItemId = id;
        e.dataTransfer.setData('text/plain', id);
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    handleDragOver(e, id) {
        if (!this.isEditMode) return;
        e.preventDefault();
        const li = e.currentTarget;
        if (id === this.draggedItemId) return;

        const targetItem = this.quizData.find(i => i.id === id);
        if (!targetItem) return;

        // Clean up previous classes
        li.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-folder');

        const rect = li.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const height = rect.height;

        if (targetItem.type === 'folder') {
            if (relativeY < height * 0.25) {
                li.classList.add('drag-over-top');
                this.dropPosition = 'above';
            } else if (relativeY > height * 0.75) {
                li.classList.add('drag-over-bottom');
                this.dropPosition = 'below';
            } else {
                li.classList.add('drag-over-folder');
                this.dropPosition = 'inside';
            }
        } else {
            if (relativeY < height / 2) {
                li.classList.add('drag-over-top');
                this.dropPosition = 'above';
            } else {
                li.classList.add('drag-over-bottom');
                this.dropPosition = 'below';
            }
        }
    }

    isDescendant(targetId, potentialParentId) {
        let currentParentId = potentialParentId;
        while (currentParentId) {
            if (currentParentId === targetId) return true;
            const parent = this.quizData.find(i => i.id === currentParentId);
            currentParentId = parent ? parent.parentId : null;
        }
        return false;
    }

    handleDrop(e, id) {
        if (!this.isEditMode) return;
        e.preventDefault();
        const targetItem = this.quizData.find(i => i.id === id);
        const draggedItem = this.quizData.find(i => i.id === this.draggedItemId);

        if (!draggedItem || !targetItem || draggedItem.id === id) return;

        if (draggedItem.type === 'folder' && this.isDescendant(draggedItem.id, id)) {
            alert('フォルダを自分自身の子要素に移動することはできません。');
            return;
        }

        const data = [...this.quizData];
        const itemIdx = data.findIndex(i => i.id === this.draggedItemId);
        if (itemIdx === -1) return;
        const item = data.splice(itemIdx, 1)[0];

        if (this.dropPosition === 'inside' && targetItem.type === 'folder') {
            item.parentId = targetItem.id;
            targetItem.isCollapsed = false;
            data.push(item);
        } else {
            item.parentId = targetItem.parentId;
            let targetIdx = data.findIndex(d => d.id === id);
            if (this.dropPosition === 'below') targetIdx++;
            data.splice(targetIdx, 0, item);
        }

        this.quizData = data;
        this.saveData();
        this.renderTOC();
    }

    handleDragEnd(e) {
        this.draggedItemId = null;
        this.renderTOC();
    }

    movePageById(id, direction) {
        const index = this.quizData.findIndex(i => i.id === id);
        if (index !== -1) this.movePage(index, direction);
    }

    toggleFolder(id) {
        const folder = this.quizData.find(s => s.id === id);
        if (folder && folder.type === 'folder') {
            folder.isCollapsed = !folder.isCollapsed;
            this.saveData();
            this.renderTOC();
        }
    }

    showContextMenu(e, id) {
        e.preventDefault();
        e.stopPropagation(); // Prevent bubbling up to window click listener
        this.ctxItemId = id;
        const item = this.quizData.find(s => s.id === id);
        if (!item) return;

        this.contextMenu.style.left = `${e.clientX}px`;
        this.contextMenu.style.top = `${e.clientY}px`;
        this.contextMenu.classList.remove('hidden');

        // Adjust menu content based on item type (Folder vs Page)
        const isFolder = item.type === 'folder';
        const addFolder = document.getElementById('ctx-add-folder');
        const addPage = document.getElementById('ctx-add-page');
        const addClause = document.getElementById('ctx-add-clause');

        if (isFolder) {
            addFolder.textContent = '📁 子フォルダを追加';
            addPage.textContent = '📄 子ページを追加';
            addClause.textContent = '🔤 子条文穴埋めを追加';
        } else {
            addFolder.textContent = '📁 隣にフォルダを追加';
            addPage.textContent = '📄 隣にページを追加';
            addClause.textContent = '🔤 隣に条文穴埋めを追加';
        }

        // Adjust visibility or content of other items if necessary
    }

    hideContextMenu() {
        if (this.contextMenu) this.contextMenu.classList.add('hidden');
    }

    ctxAction(action) {
        const id = this.ctxItemId;
        const item = this.quizData.find(s => s.id === id);
        if (!item) { this.hideContextMenu(); return; }

        // Folders usually get children, pages get siblings
        const parentId = item.type === 'folder' ? item.id : item.parentId;

        switch (action) {
            case 'add-folder': this.addNewFolder(parentId); break;
            case 'add-page': this.addNewPage(parentId); break;
            case 'add-clause': this.addNewClausePage(parentId); break;
            case 'batch-add-clause': this.showBatchAddModal(parentId); break;
            case 'rename':
                const newTitle = prompt('新しい名前を入力してください:', item.title);
                if (newTitle && newTitle.trim()) {
                    item.title = newTitle.trim();
                    this.saveData();
                    this.renderTOC();
                    if (this.currentSetId === id) this.quizTitle.textContent = item.title;
                }
                break;
            case 'move-up': this.movePageById(id, -1); break;
            case 'move-down': this.movePageById(id, 1); break;
            case 'delete':
                if (item.type === 'folder') this.deleteFolder(id);
                else {
                    if (confirm(`このページ（${item.title}）を完全に削除しますか？`)) {
                        this.quizData = this.quizData.filter(s => s.id !== id);
                        this.saveData();
                        this.renderTOC();
                        if (this.currentSetId === id) this.loadSet(null);
                    }
                }
                break;
        }
        this.hideContextMenu();
    }

    toggleItemPool(id) {
        const item = this.quizData.find(s => s.id === id);
        if (!item) return;

        const newState = !item.isInPool;

        // Recursive function to apply state to descendants
        const applyRecursive = (parentId, state) => {
            this.quizData.forEach(child => {
                if (child.parentId === parentId) {
                    child.isInPool = state;
                    if (child.type === 'folder') {
                        applyRecursive(child.id, state);
                    }
                }
            });
        };

        item.isInPool = newState;
        if (item.type === 'folder') {
            applyRecursive(item.id, newState);
        }

        this.saveData();
        this.renderTOC();
        this.updateDashboard();
    }

    clearAllPoolSelections() {
        if (!confirm('特訓対象のチェックをすべて外しますか？')) return;
        this.quizData.forEach(item => {
            item.isInPool = false;
        });
        this.saveData();
        this.renderTOC();
        this.updateDashboard();
    }

    selectAllPoolSelections() {
        if (!confirm('すべての問題を特訓対象に含めますか？')) return;
        this.quizData.forEach(item => {
            item.isInPool = true;
        });
        this.saveData();
        this.renderTOC();
        this.updateDashboard();
    }

    isItemSelectedForPool(itemId) {
        const item = this.quizData.find(i => i.id === itemId);
        return item ? !!item.isInPool : false;
    }

    collapseAllFolders() {
        this.quizData.forEach(item => {
            if (item.type === 'folder') item.isCollapsed = true;
        });
        this.saveData();
        this.renderTOC();
    }

    expandAllFolders() {
        this.quizData.forEach(item => {
            if (item.type === 'folder') item.isCollapsed = false;
        });
        this.saveData();
        this.renderTOC();
    }

    deleteFolder(id) {
        if (!this.isEditMode) return;
        const folder = this.quizData.find(s => s.id === id);
        if (!folder) return;

        const children = this.quizData.filter(item => item.parentId === id);
        let msg = `フォルダ「${folder.title}」を削除しますか？`;
        if (children.length > 0) {
            msg += `\n\n注意：中身の問題（${children.length}件）は削除されませんが、フォルダから出されます。`;
        }

        if (confirm(msg)) {
            // Unparent children
            children.forEach(child => child.parentId = null);
            // Remove folder
            this.quizData = this.quizData.filter(s => s.id !== id);
            this.saveData();
            this.renderTOC();
        }
    }

    addNewFolder(parentId = null) {
        const title = prompt('フォルダ名:');
        if (!title) return;
        const id = 'f-' + Date.now();
        this.quizData.push({
            id, title, type: 'folder', parentId: parentId, isCollapsed: false, isInPool: true
        });
        if (parentId) {
            const parent = this.quizData.find(p => p.id === parentId);
            if (parent) parent.isCollapsed = false;
        }
        this.saveData();
        this.renderTOC();
    }

    movePage(index, direction) {
        const itemsAtSameLevel = this.quizData.filter(item => item.parentId === this.quizData[index].parentId);
        const localIndex = itemsAtSameLevel.findIndex(item => item.id === this.quizData[index].id);
        const newLocalIndex = localIndex + direction;

        if (newLocalIndex < 0 || newLocalIndex >= itemsAtSameLevel.length) return;

        const targetGlobalIndex = this.quizData.findIndex(item => item.id === itemsAtSameLevel[newLocalIndex].id);

        const temp = this.quizData[index];
        this.quizData[index] = this.quizData[targetGlobalIndex];
        this.quizData[targetGlobalIndex] = temp;

        this.saveData();
        this.renderTOC();
    }

    updateActiveTOC(id) {
        this.tocList.querySelectorAll('li').forEach(li => {
            const a = li.querySelector('a');
            const isActive = a && a.getAttribute('href') === `#${id}`;
            li.classList.toggle('active', isActive);
        });
    }

    addNewPage(parentId = null) {
        const title = prompt('タイトル:'); if (!title) return;
        const isMulti = confirm('複数選択（ランキング形式）にしますか？\nOK: 複数選択, キャンセル: 単一選択');
        const id = 'p-' + Date.now();
        const cols = isMulti ? [
            "順位", "【生計維持】", "【生計同一】", "配偶者", "子", "父母", "孫", "祖父母", "兄弟姉妹", "3親等以内", "対象なし"
        ] : ["項目", "選択1", "選択2"];

        const questions = [];
        if (isMulti) {
            for (let i = 1; i <= 6; i++) {
                questions.push({ id: 'q-' + Date.now() + i, text: `第${i}順位`, answer: [] });
            }
        } else {
            questions.push({ id: 'q-' + Date.now(), text: "新問題", answer: cols[1] });
        }

        const newPage = {
            id, title, type: 'page', parentId: parentId, isMultiSelect: isMulti,
            columns: cols,
            questions: questions,
            isInPool: true
        };

        // If current viewing is a folder, maybe add to it? For now, just add to root
        this.quizData.push(newPage);

        this.isAutoGenerated = false;
        this.saveData();
        this.renderTOC();
        this.loadSet(id);

        // Scroll to the new page in the sidebar
        setTimeout(() => {
            const newElem = this.tocList.querySelector(`a[href="#${id}"]`);
            if (newElem) newElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }

    addNewClausePage(parentId = null) {
        const title = prompt('条文穴埋め問題のタイトル:'); if (!title) return;
        const id = 'p-' + Date.now();
        const newPage = {
            id, title, type: 'clause', parentId: parentId,
            text: 'ここに条文を入力してください。[[キーワード]]のように囲むとそこが穴埋めになります。',
            dummies: '',
            isInPool: true
        };
        this.quizData.push(newPage);
        this.saveData();
        this.renderTOC();
        this.loadSet(id);

        setTimeout(() => {
            const newElem = this.tocList.querySelector(`a[href="#${id}"]`);
            if (newElem) newElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
    showBatchAddModal(parentId = null) {
        this.lastBatchParentId = parentId;
        if (this.batchAddModal) {
            this.batchAddModal.classList.remove('hidden');
            if (this.batchAddText) {
                this.batchAddText.value = '';
                this.batchAddText.focus();
            }
        }
    }
    executeBatchAdd() {
        const text = this.batchAddText.value;
        if (!text) {
            if (this.batchAddModal) this.batchAddModal.classList.add('hidden');
            return;
        }
        const blocks = text.split('""').map(b => b.trim()).filter(b => b.length > 0);
        if (blocks.length === 0) {
            if (this.batchAddModal) this.batchAddModal.classList.add('hidden');
            return;
        }
        let firstId = null;
        blocks.forEach((block, index) => {
            const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) return;
            let title = lines[0].replace(/\[\[(.*?)\]\]|［［(.*?)］］|\(\((.*?)\)\)|（（(.*?)））/g, '$1$2$3$4');
            if (title.length > 50) title = title.substring(0, 47) + '...';
            const id = 'p-' + Date.now() + '-' + index;
            if (!firstId) firstId = id;
            const newPage = {
                id, title, type: 'clause', parentId: this.lastBatchParentId || null,
                text: block,
                dummies: [],
                isInPool: true
            };
            this.quizData.push(newPage);
        });
        this.saveData();
        this.renderTOC();
        if (this.batchAddModal) this.batchAddModal.classList.add('hidden');
        this.batchAddText.value = '';
        if (firstId) {
            this.loadSet(firstId);
            setTimeout(() => {
                const newElem = this.tocList.querySelector(`a[href="#${firstId}"]`);
                if (newElem) newElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }

    addNewRow() {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        set.questions.push({
            id: 'q-' + Date.now(),
            text: "新問題...",
            memo: "",
            answer: set.isMultiSelect ? [] : set.columns[1]
        });
        this.saveData();
        this.renderTable();
    }
    addNewColumn() { if (this.isAutoGenerated) return; const set = this.quizData.find(s => s.id === this.currentSetId); const name = prompt('列名:'); if (!name) return; set.columns.push(name); this.saveData(); this.renderTable(); }

    deleteCurrentPage() {
        if (this.quizData.length <= 1 || this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (!set || set.type === 'folder') {
            alert('フォルダを削除する場合は、サイドバーの「×」ボタンを使用してください。');
            return;
        }

        if (confirm(`このページ（${set.title}）の全問題データを削除しますか？\nこの操作は取り消せません。`)) {
            // Safety: if this page had children (unlikely but possible), unparent them
            const children = this.quizData.filter(item => item.parentId === this.currentSetId);
            children.forEach(c => c.parentId = null);

            this.quizData = this.quizData.filter(s => s.id !== this.currentSetId);

            // Find a valid next item (prefer a page)
            let nextItem = this.quizData.find(i => i.type === 'page' || i.type === 'clause');
            if (!nextItem) nextItem = this.quizData[0];

            this.currentSetId = nextItem ? nextItem.id : null;
            this.saveData();
            this.migrateData(); // Rescue orphans if any were created
            this.renderTOC();
            if (this.currentSetId) this.loadSet(this.currentSetId);
            else this.renderTable(); // Show empty state
        }
    }

    showDeleteConfirmModal() {
        if (this.isAutoGenerated) return;
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (!set || !set.questions) return;

        const checks = document.querySelectorAll('.row-select-checkbox:checked');
        if (checks.length === 0) {
            alert('削除する問題を選択してください。');
            return;
        }

        if (!this.deleteConfirmModal || !this.deleteTargetList) return;

        this.deleteTargetType = 'page-rows';
        this.deleteTargetList.innerHTML = '';
        const ul = document.createElement('ul');
        ul.style.listStyleType = 'disc';
        ul.style.paddingLeft = '1.5rem';
        ul.style.margin = '0';

        Array.from(checks).forEach(c => {
            const id = c.dataset.id;
            const q = set.questions.find(q => q.id === id);
            if (q) {
                const li = document.createElement('li');
                li.style.marginBottom = '0.5rem';
                li.textContent = q.text || '(空白の問題)';
                ul.appendChild(li);
            }
        });

        this.deleteTargetList.appendChild(ul);
        this.deleteConfirmModal.classList.remove('hidden');
    }

    showSidebarDeleteConfirmModal() {
        if (!this.isEditMode) return;
        const checks = document.querySelectorAll('.toc-delete-checkbox:checked');
        
        if (checks.length === 0) {
            alert('削除する項目が選択されていません。（赤いチェックボックスをオンにしてください）');
            return;
        }

        const idsToDelete = Array.from(checks).map(c => c.dataset.id);
        const targets = this.quizData.filter(item => idsToDelete.includes(item.id));

        if (!this.deleteConfirmModal || !this.deleteTargetList) return;

        this.deleteTargetType = 'sidebar-items';
        this.deleteTargetList.innerHTML = '';
        const ul = document.createElement('ul');
        ul.style.listStyleType = 'disc';
        ul.style.paddingLeft = '1.5rem';
        ul.style.margin = '0';

        const displayTargets = targets.slice(0, 50);
        displayTargets.forEach(item => {
            const li = document.createElement('li');
            li.style.marginBottom = '0.5rem';
            li.textContent = item.title || '(無題)';
            ul.appendChild(li);
        });

        if (targets.length > 50) {
            const li = document.createElement('li');
            li.style.marginBottom = '0.5rem';
            li.textContent = `...他 ${targets.length - 50} 件`;
            ul.appendChild(li);
        }

        this.deleteTargetList.appendChild(ul);
        this.deleteConfirmModal.classList.remove('hidden');
    }

    executeDeleteSelectedQuestions() {
        try {
            if (this.isAutoGenerated) return;

            if (this.deleteTargetType === 'sidebar-items') {
                const checks = document.querySelectorAll('.toc-delete-checkbox:checked');
                if (checks.length > 0) {
                    const idsToDelete = Array.from(checks).map(c => c.dataset.id);
                    this.quizData = this.quizData.filter(item => !idsToDelete.includes(item.id));
                    
                    idsToDelete.forEach(id => {
                        delete this.questionStats[this.getSummaryStatKey(id, 'page')];
                    });

                    if (idsToDelete.includes(this.currentSetId)) {
                        let nextItem = this.quizData.find(i => i.type === 'page' || i.type === 'clause');
                        this.currentSetId = nextItem ? nextItem.id : null;
                        if (this.currentSetId) this.loadSet(this.currentSetId);
                        else this.renderTable();
                    }

                    this.saveData();
                    this.renderTOC();
                    this.updateDashboard();
                }
            } else {
                const set = this.quizData.find(s => s.id === this.currentSetId);
                if (!set || !set.questions) throw new Error("セットが見つかりません。");

                const checks = document.querySelectorAll('.row-select-checkbox:checked');
                if (checks.length === 0) throw new Error("削除する項目が選択されていません。");

                const idsToDelete = Array.from(checks).map(c => c.dataset.id);
                set.questions = set.questions.filter(q => !idsToDelete.includes(q.id));

                idsToDelete.forEach(id => {
                    const baseId = this.getQuestionBaseId(id);
                    delete this.questionStats[this.getSummaryStatKey(baseId, 'page')];
                });

                this.saveData();
                this.renderTable();
                this.updateDashboard();
            }
        } catch (e) {
            console.error("削除処理中にエラーが発生しました:", e);
            alert("削除処理中にエラーが発生しました: " + e.message);
        } finally {
            if (this.deleteConfirmModal) {
                this.deleteConfirmModal.classList.add('hidden');
            }
        }
    }

    loadNextPage() {
        if (this.isAutoGenerated) {
            alert('自動生成されたレビューモードでは次の問題へ進むことはできません。');
            return;
        }
        
        // Find current in flat list
        const getFlatDisplayList = (parentId = null) => {
            let result = [];
            const items = this.quizData.filter(item => (item.parentId || null) === parentId);
            items.forEach(item => {
                result.push(item);
                if (item.type === 'folder') {
                    result = result.concat(getFlatDisplayList(item.id));
                }
            });
            return result;
        };

        const flatList = getFlatDisplayList(null).filter(item => item.type !== 'folder');
        const currentIndex = flatList.findIndex(item => item.id === this.currentSetId);
        
        if (currentIndex !== -1 && currentIndex < flatList.length - 1) {
            const nextItem = flatList[currentIndex + 1];
            this.loadSet(nextItem.id);
            // Scroll sidebar to the next item
            setTimeout(() => {
                const activeLink = this.tocList.querySelector('a.active');
                if (activeLink) {
                    activeLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        } else {
            alert('最後の問題です。');
        }
    }

    cloneCurrentPage() {
        const set = this.quizData.find(s => s.id === this.currentSetId);
        if (!set || set.type === 'folder') return;
        const clonedSet = JSON.parse(JSON.stringify(set));
        const newId = 'p-' + Date.now();
        clonedSet.id = newId;
        clonedSet.title = clonedSet.title + '（コピー）';

        // Re-generate question IDs to avoid conflicts and start fresh stats
        clonedSet.questions.forEach((q, i) => {
            q.id = 'q-' + Date.now() + '-' + i + '-' + Math.random().toString(36).substr(2, 5);
        });

        this.quizData.push(clonedSet);
        this.saveData();
        this.isAutoGenerated = false;
        this.renderTOC();
        this.loadSet(newId);
    }

    updateAutoFillShortcutUI() {
        if (!this.autoFillShortcutBtn) return;
        const isActive = this.autoFillEnabled;
        this.autoFillShortcutBtn.classList.toggle('active', isActive);
        if (isActive) {
            this.autoFillShortcutBtn.style.background = 'var(--accent)';
            this.autoFillShortcutBtn.style.color = 'var(--bg-dark)';
            this.autoFillShortcutBtn.innerHTML = `✨ 自動入力: ${this.autoFillThreshold}回`;
        } else {
            this.autoFillShortcutBtn.style.background = 'rgba(76, 201, 240, 0.1)';
            this.autoFillShortcutBtn.style.color = 'var(--accent)';
            this.autoFillShortcutBtn.innerHTML = '✨ 自動入力: OFF';
        }
    }

    clearData() {
        const input = prompt('すべての学習データと履歴を完全に削除しますか？\n削除する場合は、確認のため「RESET」と入力してください。\n注：事前に「バックアップ保存」を行うことをお勧めします。');
        if (input === 'RESET') { localStorage.clear(); window.location.reload(); } else if (input !== null) { alert('入力が正しくないため、削除はキャンセルされました。'); }
    }

    // --- Data Management (Export/Import) ---

    getTimestamp() {
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    async exportToJSON() {
        const fullData = {
            quizData: this.quizData,
            history: this.history,
            questionStats: this.questionStats,
            exportedAt: new Date().toISOString()
        };
        const fileName = `sharo_study_backup_${this.getTimestamp()}.json`;
        const jsonContent = JSON.stringify(fullData, null, 2);

        // Try File System Access API for folder selection
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(jsonContent);
                await writable.close();
                this.updateDataStatus("JSONを保存しました。");
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error("showSaveFilePicker failed:", err);
            }
        }

        // Fallback for older browsers
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        this.updateDataStatus("JSON形式でエクスポートしました（ダウンロードフォルダに保存）。");
    }

    async exportToCSV() {
        // CSV is focused on quiz questions only (for spreadsheet editing)
        let csv = '\uFEFF'; // UTF-8 BOM
        csv += 'ページタイトル,ID,問題文,正解(カンマ区切り),解説,選択肢1,選択肢2,選択肢3,選択肢4,選択肢5,選択肢6,選択肢7,選択肢8,選択肢9,選択肢10\n';

        this.quizData.forEach(page => {
            if (page.type !== 'page' || !page.questions) return;
            page.questions.forEach(q => {
                const row = [
                    page.title,
                    q.id,
                    q.text,
                    Array.isArray(q.answer) ? q.answer.join('|') : q.answer,
                    q.memo || '',
                    ...(page.columns.slice(1)) // choice choices
                ].map(val => `"${(val || "").toString().replace(/"/g, '""')}"`).join(',');
                csv += row + '\n';
            });
        });

        const fileName = `sharo_questions_${this.getTimestamp()}.csv`;

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(csv);
                await writable.close();
                this.updateDataStatus("CSVを保存しました。");
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error("showSaveFilePicker failed:", err);
            }
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        this.updateDataStatus("CSV形式でエクスポートしました（ダウンロードフォルダに保存）。");
    }

    handleFileImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            if (file.name.endsWith('.json')) {
                this.importFromJSON(content);
            } else if (file.name.endsWith('.csv')) {
                this.importFromCSV(content);
            }
        };
        reader.readAsText(file);
    }

    async importFromJSON(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            
            const isBackup = !!data.quizData;
            const incomingQuizData = Array.isArray(data) ? data : data.quizData;
            
            if (!incomingQuizData || !Array.isArray(incomingQuizData)) {
                throw new Error('Invalid JSON format: missing quiz data array');
            }

            // Auto-convert depth to parentId for AI-generated flat arrays
            let currentParents = {};
            incomingQuizData.forEach(item => {
                // Ensure IDs exist
                if (!item.id) item.id = 'import_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                
                if (item.parentId === undefined && item.depth !== undefined) {
                    item.parentId = item.depth > 0 ? (currentParents[item.depth - 1] || null) : null;
                }
                if (item.type === 'folder') {
                    let d = item.depth;
                    if (d === undefined) {
                        let curr = item;
                        d = 0;
                        while (curr && curr.parentId) {
                            d++;
                            curr = incomingQuizData.find(x => x.id === curr.parentId);
                        }
                    }
                    currentParents[d] = item.id;
                }
            });

            if (isBackup) {
                if (confirm('現在のデータをすべて上書きして復元しますか？\n（現在の問題・履歴・統計がすべて消え、ファイルの内容に置き換わります）')) {
                    this.quizData = incomingQuizData;
                    this.history = data.history || [];
                    this.questionStats = data.questionStats || {};
                    await this.saveAll();
                    alert('データを正常に復元しました。');
                    window.location.reload();
                }
            } else {
                if (confirm('AI等で作成された問題データが検出されました。\n現在のデータに追加（マージ）しますか？')) {
                    // Prepend or append? Usually append.
                    this.quizData = [...this.quizData, ...incomingQuizData];
                    await this.saveAll();
                    alert('新しい問題を追加しました。');
                    window.location.reload();
                }
            }
        } catch (err) {
            console.error(err);
            alert('ファイルの読み込みに失敗しました。有効なJSONフォーマットであることを確認してください。');
        }
    }

    importFromCSV(csvString) {
        try {
            const lines = csvString.split(/\r?\n/);
            if (lines.length < 2) return;

            // Simple CSV parser (not handling all escapes, but works for standard export)
            const parseCSVLine = (line) => {
                const parts = [];
                let current = '';
                let inQuotes = false;
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
                    else if (char === '"') inQuotes = !inQuotes;
                    else if (char === ',' && !inQuotes) { parts.push(current); current = ''; }
                    else current += char;
                }
                parts.push(current);
                return parts;
            };

            const header = parseCSVLine(lines[0]);
            const newPages = new Map();

            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const row = parseCSVLine(lines[i]);
                const pageTitle = row[0];
                const id = row[1] || ('q-' + Math.random().toString(36).substr(2, 9));
                const text = row[2];
                const answerRaw = row[3];
                const choices = row.slice(4).filter(c => c !== undefined && c !== "");

                if (!pageTitle || !text) continue;

                if (!newPages.has(pageTitle)) {
                    newPages.set(pageTitle, {
                        id: 'p-' + Date.now() + Math.random().toString(36).substr(2, 5),
                        title: pageTitle,
                        type: 'page',
                        parentId: null,
                        isCollapsed: false,
                        columns: ["項目", ...choices],
                        questions: [],
                        isMultiSelect: answerRaw.includes('|')
                    });
                }

                const page = newPages.get(pageTitle);
                page.questions.push({
                    id: id,
                    text: text,
                    answer: page.isMultiSelect ? answerRaw.split('|') : answerRaw,
                    isInPool: true
                });
            }

            if (confirm(`CSVから ${newPages.size} ページの問題を取り込みますか？\n既存のページは維持され、末尾に追加されます。`)) {
                this.quizData.push(...Array.from(newPages.values()));
                this.saveData();
                alert('CSVからデータを正常に取り込みました。');
                this.renderTOC();
                this.loadSet(this.currentSetId);
            }
        } catch (err) {
            console.error(err);
            alert('CSVの解析に失敗しました。');
        }
    }

    updateDataStatus(msg) {
        if (this.dataStatusMsg) {
            this.dataStatusMsg.textContent = `${msg} (${new Date().toLocaleTimeString()})`;
            this.dataStatusMsg.style.color = 'var(--success)';
            setTimeout(() => {
                this.dataStatusMsg.style.color = 'var(--text-secondary)';
            }, 5000);
        }
        // Save export timestamp for reminder
        if (msg.includes("エクスポート")) {
            localStorage.setItem('sharo_last_export_at', new Date().toISOString());
            this.checkBackupFrequency();
        }
    }

    // --- Automatic Recovery and Protection ---

    async checkAndOfferRecovery(manual = false) {
        const backupStr = localStorage.getItem('sharo_auto_backup');
        if (!backupStr) {
            if (manual) alert('内部バックアップが見つかりません。');
            return;
        }

        try {
            const backup = JSON.parse(backupStr);
            const isMainEmpty = (this.quizData.length <= DEFAULT_QUIZ_DATA.length && this.history.length === 0);

            if (manual || isMainEmpty) {
                const date = new Date(backup.savedAt).toLocaleString();
                const msg = manual
                    ? `内部バックアップ（保存日時: ${date}）からデータを復元しますか？\n現在編集中の内容は上書きされます。`
                    : `【データ復旧の案内】\nメインデータが初期状態のようですが、内部バックアップ（保存日時: ${date}）が見つかりました。\n以前の状態を復元しますか？`;

                if (confirm(msg)) {
                    this.quizData = backup.quizData;
                    this.history = backup.history || [];
                    this.questionStats = backup.questionStats || {};
                    await this.saveAll();
                    alert('データを正常に復元しました。');
                    window.location.reload();
                }
            }
        } catch (e) {
            console.error("Backup parse error", e);
        }
    }

    checkBackupFrequency() {
        const lastExport = localStorage.getItem('sharo_last_export_at');
        if (!lastExport) return;

        const hoursSince = (Date.now() - new Date(lastExport).getTime()) / (1000 * 60 * 60);
        if (hoursSince > 24) {
            const reminderArea = document.getElementById('backup-reminder');
            if (reminderArea) {
                reminderArea.style.display = 'block';
                reminderArea.innerHTML = `⚠️ 最終エクスポートから24時間以上経過しています。大切なデータを守るため、<span style="color:var(--accent); cursor:pointer; text-decoration:underline;" onclick="app.exportToJSON()">JSONバックアップの保存</span>をお勧めします。`;
            }
        } else {
            const reminderArea = document.getElementById('backup-reminder');
            if (reminderArea) reminderArea.style.display = 'none';
        }
    }

    setupQuestionObserver() {
        if (this.questionObserver) this.questionObserver.disconnect();

        const options = {
            root: null,
            rootMargin: '-5% 0px -20% 0px',
            threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
        };

        this.questionObserver = new IntersectionObserver(() => {
            this.activateFirstVisibleBank();
        }, options);

        const targets = document.querySelectorAll('#quiz-table tr, .auto-gen-table tr');
        targets.forEach(t => {
            if (t.dataset.keywords) {
                this.questionObserver.observe(t);
            }
        });

        // Fallback: also update on scroll for smoother experience
        if (this._scrollHandler) window.removeEventListener('scroll', this._scrollHandler);
        this._scrollHandler = () => this.activateFirstVisibleBank();
        window.addEventListener('scroll', this._scrollHandler, { passive: true });

        this.activateFirstVisibleBank();
        setTimeout(() => this.activateFirstVisibleBank(), 300);
    }

    activateFirstVisibleBank() {
        if (this.isEditMode || this.isChecked) {
            if (this.globalKeywordBank) {
                this.globalKeywordBank.classList.add('hidden');
                this.globalKeywordBank.classList.remove('active-bank');
            }
            this._currentActiveRowId = null;
            return;
        }

        const targets = Array.from(document.querySelectorAll('#quiz-table tr, .auto-gen-table tr')).filter(r => r.dataset.keywords);

        const isSingleClause = !this.clauseDisplay.classList.contains('hidden');
        const isHome = this.homeDashboard && !this.homeDashboard.classList.contains('hidden');

        if (targets.length === 0) {
            if (!isSingleClause || isHome) {
                if (this.globalKeywordBank) {
                    this.globalKeywordBank.classList.add('hidden');
                    this.globalKeywordBank.classList.remove('active-bank');
                }
                this._currentActiveRowId = null;
            }
            return;
        }

        // 画面上部から40%の位置を「切り替えの閾値」とする
        const focusThreshold = window.innerHeight * 0.4;
        let bestRow = null;

        // ビューポート内にあるターゲットを取得
        const visibleTargets = targets.filter(tr => {
            const rect = tr.getBoundingClientRect();
            return rect.top < window.innerHeight && rect.bottom > 0;
        });

        if (visibleTargets.length > 0) {
            // 「現在の行」の底辺が閾値より下にある限り、その行を優先する（上から順に探す）
            bestRow = visibleTargets.find(tr => {
                const rect = tr.getBoundingClientRect();
                return rect.bottom > focusThreshold;
            });

            // すべてが閾値より上に行った場合は、一番下の可視行を選択
            if (!bestRow) bestRow = visibleTargets[visibleTargets.length - 1];
        }

        // 選択された行があっても、画面外（極端に下など）すぎる場合は非表示
        if (bestRow) {
            const rect = bestRow.getBoundingClientRect();
            if (rect.top > window.innerHeight * 0.9) bestRow = null;
        }

        if (bestRow) {
            if (this._currentActiveRowId !== bestRow.id) {
                this._currentActiveRowId = bestRow.id;
                this.updateGlobalKeywordBank(bestRow);
            }
        } else {
            if (this._currentActiveRowId !== null) {
                this._currentActiveRowId = null;
                if (this.globalKeywordBank) {
                    this.globalKeywordBank.classList.add('hidden');
                    this.globalKeywordBank.classList.remove('active-bank');
                }
            }
        }
    }

    updateGlobalKeywordBank(row) {
        if (!this.globalKeywordBank) return;

        // Hide bank if we are in "isChecked" mode or Edit mode
        if (this.isChecked || this.isEditMode || !row || !row.dataset.keywords) {
            this.globalKeywordBank.classList.add('hidden');
            this.globalKeywordBank.classList.remove('active-bank');
            this._currentActiveRowId = null;
            return;
        }

        const qid = row.dataset.qid;
        const allOptions = JSON.parse(row.dataset.keywords);
        const requiredCounts = JSON.parse(row.dataset.requiredCounts);

        const cacheKey = `bank-${qid}`;
        if (!this.shuffledCache[cacheKey]) {
            let optionsToDisplay = allOptions;
            if (allOptions.length > this.MAX_DISPLAYED_CHOICES) {
                const shuffledSet = [...allOptions].sort(() => Math.random() - 0.5);
                optionsToDisplay = shuffledSet.slice(0, this.MAX_DISPLAYED_CHOICES);
                // Trigger auto-fill for this subset
                this.applyAutoFillForHiddenChoices(qid, optionsToDisplay);
            }
            this.shuffledCache[cacheKey] = optionsToDisplay.sort(() => Math.random() - 0.5);
        }

        const usedCounts = {};
        Object.keys(this.userAnswers).forEach(key => {
            if (key.startsWith(`${qid}-`)) {
                const ans = this.userAnswers[key];
                usedCounts[ans] = (usedCounts[ans] || 0) + 1;
            }
        });
        const topAns = this.userAnswers[qid];
        if (topAns) {
            if (Array.isArray(topAns)) topAns.forEach(a => usedCounts[a] = (usedCounts[a] || 0) + 1);
            else usedCounts[topAns] = (usedCounts[topAns] || 0) + 1;
        }

        this.globalKeywordBank.innerHTML = '';
        this.globalKeywordBank.classList.remove('hidden');
        this.globalKeywordBank.classList.add('active-bank');
        this.globalKeywordBank.classList.toggle('minimized', this.isBankMinimized);

        // Add Header for minimization
        const bankHeader = document.createElement('div');
        bankHeader.className = 'keyword-bank-header';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'bank-title';
        titleSpan.textContent = this.isBankMinimized ? '選択肢バンク (最小化中)' : '選択肢バンク';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'bank-toggle-btn';
        toggleBtn.textContent = this.isBankMinimized ? '▲ 展開する' : '▼ 最小化する';
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            this.isBankMinimized = !this.isBankMinimized;
            this.updateGlobalKeywordBank(row);
        };

        bankHeader.appendChild(titleSpan);
        bankHeader.appendChild(toggleBtn);
        this.globalKeywordBank.appendChild(bankHeader);

        if (this.isBankMinimized) return;

        this.shuffledCache[cacheKey].forEach(word => {
            const req = requiredCounts[word] || 0;
            const used = usedCounts[word] || 0;
            const isUsed = req > 0 ? (used >= req) : (used > 0);

            const card = document.createElement('div'); card.className = `keyword-card ${isUsed ? 'used' : ''}`;
            if (req > 1 && !isUsed) {
                card.innerHTML = `${word} <span class="keyword-count-badge">${req - used}</span>`;
            } else {
                card.textContent = word;
            }
            if (this.selectedKeyword === word) card.classList.add('selected');

            card.draggable = !isUsed;
            card.onclick = (e) => {
                if (isUsed) return;
                if (this.selectedKeyword === word) {
                    this.selectedKeyword = null;
                } else {
                    this.selectedKeyword = word;
                }
                this.updateGlobalKeywordBank(row);
            };
            card.ondragstart = (e) => {
                if (isUsed) return;
                e.dataTransfer.setData('text/plain', word);
                card.classList.add('dragging');
                // Store active qid globally for drop handling if needed
                this.activeDragQid = qid;
            };
            card.ondragend = () => card.classList.remove('dragging');
            this.globalKeywordBank.appendChild(card);
        });
    }

    mergeStats(local, remote) {
        const merged = JSON.parse(JSON.stringify(remote));
        for (const [key, lStat] of Object.entries(local)) {
            if (!merged[key]) {
                merged[key] = lStat;
            } else {
                const rStat = merged[key];
                if (lStat.history && rStat.history) {
                    const combined = [...lStat.history, ...rStat.history];
                    const unique = [];
                    const seen = new Set();
                    combined.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(h => {
                        if (!seen.has(h.date)) {
                            unique.push(h); seen.add(h.date);
                        }
                    });
                    rStat.history = unique.slice(0, 50);
                    rStat.total = unique.length;
                    rStat.correct = unique.filter(h => h.isCorrect).length;
                } else {
                    if ((lStat.total || 0) > (rStat.total || 0)) {
                        rStat.total = lStat.total;
                        rStat.correct = lStat.correct;
                        if (lStat.recent) rStat.recent = lStat.recent;
                    }
                }
                if (lStat.nextReview && (!rStat.nextReview || new Date(lStat.nextReview) > new Date(rStat.nextReview))) {
                    rStat.nextReview = lStat.nextReview;
                    rStat.srsLevel = lStat.srsLevel;
                }
            }
        }
        return merged;
    }

    mergeHistory(local, remote) {
        const combined = [...local, ...remote];
        const unique = [];
        const seen = new Set();
        combined.sort((a, b) => new Date(b.isoDate || 0) - new Date(a.isoDate || 0)).forEach(h => {
            const key = (h.isoDate || h.timestamp) + h.pageId;
            if (!seen.has(key)) {
                unique.push(h); seen.add(key);
            }
        });
        return unique.slice(0, 50);
    }

    async syncWithGitHub() {
        const config = JSON.parse(localStorage.getItem('sharoGitHubConfig') || '{}');
        if (!config.token || !config.repo) {
            alert('GitHubの設定（トークンとリポジトリ）を先に保存してください。');
            return;
        }

        const forceRepaint = () => new Promise(resolve => setTimeout(resolve, 100));
        if (this.ghSyncNowBtn) { this.ghSyncNowBtn.disabled = true; this.ghSyncNowBtn.textContent = '同期中...'; }
        if (this.sidebarGhSyncBtn) { this.sidebarGhSyncBtn.disabled = true; this.sidebarGhSyncBtn.textContent = '同期中...'; }
        this.updateGitHubStatus('同期中...');

        try {
            // Pre-sync backup
            const backupData = { quizData: this.quizData, questionStats: this.questionStats, history: this.history };
            await window.idbSet('sharoBackupBeforeSync', { data: backupData, date: Date.now() });

            this.updateGitHubStatus('データをダウンロード中...');
            await forceRepaint();
            const remote = await this.fetchFromGitHub(config);
            
            const lastSyncModified = parseInt(localStorage.getItem('sharoLastSyncModified') || '0');
            const localModified = parseInt(localStorage.getItem('sharoLastModified') || '0');
            const localData = { quizData: this.quizData, questionStats: this.questionStats, history: this.history, lastModified: localModified };

            if (!remote) {
                // First time sync: just push
                this.updateGitHubStatus('初回同期（アップロード中）...');
                localData.lastModified = Date.now();
                await this.pushToGitHub(config, localData, forceRepaint);
                localStorage.setItem('sharoLastSyncModified', localData.lastModified);
                localStorage.setItem('sharoLastModified', localData.lastModified);
                this.updateGitHubStatus(`同期完了 (${new Date().toLocaleTimeString()})`);
                alert('初回同期が完了しました。');
                return;
            }

            const remoteModified = remote.lastModified || 0;
            const hasRemoteChanged = remoteModified > lastSyncModified;
            const hasLocalChanged = localModified > lastSyncModified;

            if (hasRemoteChanged && hasLocalChanged) {
                // CONFLICT
                const choice = confirm(`【競合】GitHubとローカルの両方に新しい変更があります。\n\n・OK: データを統合して同期（推奨）\n・キャンセル: 今回は中断`);
                if (!choice) {
                    this.updateGitHubStatus('同期中断');
                    return;
                }
                this.updateGitHubStatus('データを統合中...');
                await forceRepaint();
                this.questionStats = this.mergeStats(this.questionStats, remote.questionStats || {});
                this.history = this.mergeHistory(this.history, remote.history || []);
                // quizData merging is complex; for now strictly latest wins
                if (remoteModified > localModified) this.quizData = remote.quizData;
                
                const mergedData = { quizData: this.quizData, questionStats: this.questionStats, history: this.history, lastModified: Date.now() };
                await this.pushToGitHub(config, mergedData, forceRepaint);
                await this.saveAll();
                localStorage.setItem('sharoLastSyncModified', mergedData.lastModified);
                localStorage.setItem('sharoLastModified', mergedData.lastModified);
                alert('データの統合と同期が完了しました。');
                location.reload();
                return;
            } else if (hasRemoteChanged) {
                // Remote is newer, local hasn't changed since last sync
                if (confirm(`GitHub上に新しいデータがあります（${new Date(remoteModified).toLocaleString()}）。読み込みますか？`)) {
                    this.quizData = remote.quizData;
                    this.questionStats = remote.questionStats;
                    this.history = remote.history;
                    await this.saveAll();
                    localStorage.setItem('sharoLastSyncModified', remoteModified);
                    localStorage.setItem('sharoLastModified', remoteModified);
                    alert('リモートのデータを読み込みました。');
                    location.reload();
                    return;
                }
            } else if (hasLocalChanged || remoteModified !== localModified) {
                // Local is newer or timestamps differ for other reasons: push local
                this.updateGitHubStatus('アップデートを送信中...');
                localData.lastModified = Date.now();
                await this.pushToGitHub(config, localData, forceRepaint);
                localStorage.setItem('sharoLastSyncModified', localData.lastModified);
                localStorage.setItem('sharoLastModified', localData.lastModified);
                this.updateGitHubStatus(`同期完了 (${new Date().toLocaleTimeString()})`);
                alert('最新の記録をクラウドに保存しました。');
            } else {
                this.updateGitHubStatus('データは最新です');
                alert('データは既に最新の状態です。');
            }
        } catch (error) {
            console.error('Sync error:', error);
            alert('同期に失敗しました: ' + error.message);
            this.updateGitHubStatus('同期失敗');
        } finally {
            if (this.ghSyncNowBtn) { this.ghSyncNowBtn.disabled = false; this.ghSyncNowBtn.textContent = '今すぐ同期（アップロード＆ダウンロード）'; }
            if (this.sidebarGhSyncBtn) { this.sidebarGhSyncBtn.disabled = false; this.sidebarGhSyncBtn.textContent = '今すぐ同期'; }
        }
    }

    applyAutoFillForHiddenChoices(qid, visibleChoices) {
        const visibleSet = new Set(visibleChoices);
        const set = this.isAutoGenerated ? this.autoGeneratedSet : this.quizData.find(s => s.id === this.currentSetId);
        if (!set) return;

        let question = null;
        if (set.type === 'clause' && set.id === qid) {
            question = set;
        } else if (set.questions) {
            question = set.questions.find(q => q.id === qid);
        }

        if (!question) return;

        let changed = false;
        if (question.type === 'clause' || /\[\[|［［|\(\(|（（/.test(question.text || '')) {
            const keywords = this.extractKeywords(question.text);
            keywords.forEach((kw, idx) => {
                const key = `${qid}-${idx}`;
                // Only auto-fill if it's a "drag" keyword that was hidden from the bank.
                // Numerical inputs (type: 'input') are never part of the bank and should not be auto-filled.
                if (kw.type === 'drag' && !visibleSet.has(kw.text)) {
                    if (!this.userAnswers[key]) {
                        this.userAnswers[key] = kw.text;
                        this.autoFilledAnswers.add(key);
                        changed = true;
                    }
                }
            });
        } else {
            const isQMulti = this.isAutoGenerated ? question.isMultiSelect : set.isMultiSelect;
            if (isQMulti && Array.isArray(question.answer)) {
                const hiddenAnswers = question.answer.filter(a => !visibleSet.has(a));
                if (hiddenAnswers.length > 0) {
                    if (!Array.isArray(this.userAnswers[qid])) this.userAnswers[qid] = [];
                    hiddenAnswers.forEach(a => {
                        if (!this.userAnswers[qid].includes(a)) {
                            this.userAnswers[qid].push(a);
                            changed = true;
                        }
                    });
                    if (changed) this.autoFilledAnswers.add(qid);
                }
            } else if (!visibleSet.has(question.answer)) {
                if (!this.userAnswers[qid]) {
                    this.userAnswers[qid] = question.answer;
                    this.autoFilledAnswers.add(qid);
                    changed = true;
                }
            }
        }

        if (changed) {
            this.saveAutoFilledAnswers();
            setTimeout(() => {
                if (set.type === 'clause') this.renderClauseView(set);
                else this.renderTable();
            }, 0);
        }
    }

    // --- GitHub Sync Methods ---

    loadGitHubConfig() {
        const config = JSON.parse(localStorage.getItem('sharoGitHubConfig') || '{}');
        if (this.ghTokenInput) this.ghTokenInput.value = config.token || '';
        if (this.ghRepoInput) this.ghRepoInput.value = config.repo || '';
        if (this.ghPathInput) this.ghPathInput.value = config.path || 'data/sharo_study_sync.json';
        this.updateGitHubStatus();
    }

    saveGitHubConfig() {
        const config = {
            token: this.ghTokenInput.value.trim(),
            repo: this.ghRepoInput.value.trim(),
            path: this.ghPathInput.value.trim()
        };
        localStorage.setItem('sharoGitHubConfig', JSON.stringify(config));
        alert('GitHubの設定を保存しました。');
        this.updateGitHubStatus();
    }

    updateGitHubStatus(msg = null) {
        if (!this.ghSyncStatus) return;
        const config = JSON.parse(localStorage.getItem('sharoGitHubConfig') || '{}');
        if (!config.token || !config.repo) {
            this.ghSyncStatus.textContent = '未連携';
            this.ghSyncStatus.className = 'github-connect-status';
            return;
        }
        this.ghSyncStatus.textContent = msg || '連携済み（同期ボタンを押してください）';
        this.ghSyncStatus.className = 'github-connect-status synced';
    }


    async fetchFromGitHub(config) {
        const url = `https://api.github.com/repos/${config.repo}/contents/${config.path}`;
        const headers = {
            'Authorization': config.token.startsWith('ghp_') ? `token ${config.token}` : `Bearer ${config.token}`
        };

        // 1. Get SHA via HEAD request (bypasses 1MB body limit)
        const headResponse = await fetch(url, { method: 'HEAD', headers });
        if (headResponse.status === 404) return null;
        if (!headResponse.ok) throw new Error(`Metadata check failed: ${headResponse.status}`);

        // GitHub ETag for blobs/contents is the SHA
        const etag = headResponse.headers.get('ETag');
        this._ghFileSha = etag ? etag.replace(/"/g, '') : null;

        // 2. Fetch content via Raw media type (handles up to 100MB)
        const rawResponse = await fetch(url, {
            headers: { ...headers, 'Accept': 'application/vnd.github.v3.raw' }
        });

        if (!rawResponse.ok) {
            throw new Error(`Content fetch failed: ${rawResponse.status}`);
        }

        const content = await rawResponse.text();
        if (!content) return null;

        try {
            return JSON.parse(content);
        } catch (e) {
            console.error('JSON Parse Error. Raw content start:', content.substring(0, 100));
            throw new Error('リモートのJSONファイルが壊れているか、空です。');
        }
    }

    async pushToGitHub(config, data, forceRepaint = async () => {}) {
        this.pruneData();
        const url = `https://api.github.com/repos/${config.repo}/contents/${config.path}`;
        
        this.updateGitHubStatus('データをエンコード中 (数秒かかる場合があります)...');
        await forceRepaint();
        const content = await this.utf8_to_b64_encode(JSON.stringify(data));

        this.updateGitHubStatus('GitHubへアップロード中...');
        await forceRepaint();
        // Need current SHA to update existing file
        if (!this._ghFileSha) {
            const headResponse = await fetch(url, {
                method: 'HEAD',
                headers: { 'Authorization': config.token.startsWith('ghp_') ? `token ${config.token}` : `Bearer ${config.token}` }
            });
            if (headResponse.ok) {
                const etag = headResponse.headers.get('ETag');
                this._ghFileSha = etag ? etag.replace(/"/g, '') : null;
            }
        }

        const body = {
            message: 'Sync sharo study data',
            content: content,
            sha: this._ghFileSha
        };

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': config.token.startsWith('ghp_') ? `token ${config.token}` : `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Push failed');
        }

        const resData = await response.json();
        this._ghFileSha = resData.content.sha;
    }

    // Helper for Unicode-safe Base64 that prevents memory crashes on iOS
    async utf8_to_b64_encode(str) {
        return new Promise((resolve, reject) => {
            const blob = new Blob([str], { type: 'application/json' });
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const base64 = dataUrl.split(',')[1];
                resolve(base64);
            };
            reader.onerror = error => reject(error);
            reader.readAsDataURL(blob);
        });
    }

    // --- Law Article Drill Methods ---

    formatEGovAnchor(anchor) {
        if (!anchor) return "全体";
        let text = "";
        
        if (anchor.startsWith('Sp')) {
            text += "附則 ";
        }
        
        const atMatch = anchor.match(/At_([\d_]+)/);
        if (atMatch) {
            const parts = atMatch[1].split('_');
            text += `第${parts[0]}条`;
            if (parts.length > 1) text += `の${parts.slice(1).join('の')}`;
        }
        const prMatch = anchor.match(/Pr_([\d_]+)/);
        if (prMatch) {
            const parts = prMatch[1].split('_');
            text += `第${parts[0]}項`;
            if (parts.length > 1) text += `の${parts.slice(1).join('の')}`;
        }
        const itMatch = anchor.match(/It_([\d_]+)/);
        if (itMatch) {
            const parts = itMatch[1].split('_');
            text += `第${parts[0]}号`;
            if (parts.length > 1) text += `の${parts.slice(1).join('の')}`;
        }
        return text || anchor;
    }

    getAlias(lawId) {
        if (!lawId) return lawId;
        const ALIAS_MAP = {
            "215CO0000000243": "215IO0000000243",
            "350M50002000025": "350M50002000003",
            "311AC0000000070": "211AC0000000070",
            "361CO0000000053": "361CO0000000054",
            "402M50000100034": "402M50000100058",
            "347CO0000000063": "348CO0000000195"
        };
        return ALIAS_MAP[lawId] || lawId;
    }

    getMappedLawId(lawId, anchor) {
        if (!lawId) return lawId;
        let mapped = getAlias(lawId);

        const AMENDMENT_LAW_MAP = {
            "416AC0000000104": "334AC0000000141", // 平成16年法律第104号 -> 国民年金法
            "406AC0000000095": "334AC0000000141"  // 平成6年法律第95号 -> 国民年金法
        };
        
        mapped = AMENDMENT_LAW_MAP[mapped] || mapped;

        // 特殊対応: 平成12年法律第18号
        if (mapped === "412AC0000000018" || lawId === "412AC0000000018") {
            mapped = "334AC0000000141"; // Default to Kokumin Nenkin
            if (anchor && anchor.startsWith("Sp")) {
                const atMatch = anchor.match(/At_(\d+)/);
                if (atMatch) {
                    const artNum = parseInt(atMatch[1], 10);
                    // 第4条〜第36条等は厚生年金保険法に属する
                    if (artNum >= 4 && artNum <= 36) {
                        mapped = "329AC0000000115";
                    }
                }
            }
        }

        // 特殊対応: 昭和60年法律第34号（国民年金法等の一部を改正する法律）は
        // 附則の第1条〜第42条等までは「国民年金法（334AC0000000141）」のXMLにぶら下がり、
        // 第43条〜第104条等は「厚生年金保険法（329AC0000000115）」のXMLにぶら下がるため
        // アンカーの条数を見て動的に親のLawIdを振り分ける
        if (mapped === "360AC0000000034" || lawId === "360AC0000000034") {
            mapped = "334AC0000000141"; // Default to Kokumin Nenkin
            if (anchor && anchor.startsWith("Sp")) {
                const atMatch = anchor.match(/At_(\d+)/);
                if (atMatch) {
                    const artNum = parseInt(atMatch[1], 10);
                    // 第43条以降は厚生年金保険法の方に属する
                    if (artNum >= 43) {
                        mapped = "329AC0000000115";
                    }
                }
            }
        }
        
        // 特殊対応: 平成24年法律第63号
        if (mapped === "424AC0000000063" || lawId === "424AC0000000063") {
            mapped = "329AC0000000115"; // Default to Kousei Nenkin (Art 17 etc)
            if (anchor && anchor.startsWith("Sp")) {
                const atMatch = anchor.match(/At_(\d+)/);
                if (atMatch) {
                    const artNum = parseInt(atMatch[1], 10);
                    if (artNum === 25) {
                        mapped = "334AC0000000141"; // Art 25 is in Kokumin Nenkin
                    }
                }
            }
        }

        return mapped;
    }

    getKnownLawName(lawId) {
        const KNOWN_LAWS = {
            "322AC0000000049": "労働基準法",
            "347AC0000000057": "労働安全衛生法",
            "347CO0000000318": "労働安全衛生法施行令",
            "347M50002000032": "労働安全衛生規則",
            "322AC0000000050": "労働者災害補償保険法",
            "360AC0000000088": "労働者派遣事業の適正な運営の確保及び派遣労働者の保護等に関する法律",
            "348CO0000000195": "労働保険事務組合に対する報奨金に関する政令",
            "349AC0000000116": "雇用保険法",
            "344AC0000000084": "労働保険徴収法",
            "211AC0000000070": "健康保険法",
            "329AC0000000115": "厚生年金保険法",
            "334AC0000000141": "国民年金法",
            "334CO0000000184": "国民年金法施行令",
            "335M50000100012": "国民年金法施行規則",
            "402CO0000000304": "国民年金基金令",
            "402M50000100058": "国民年金基金規則",
            "334AC0000000137": "最低賃金法",
            "346AC0000000113": "高年齢者雇用安定法",
            "347M50002000010": "失業保険法及び労働者災害補償保険法の一部を改正する法律及び労働保険の保険料の徴収等に関する法律の施行に伴う関係法律の整備等に関する法律の施行に関する省令",
            "412AC0000000018": "国民年金法等の一部を改正する法律（平成12年法律第18号）",
            "416AC0000000104": "国民年金法等の一部を改正する法律（平成16年法律第104号）",
            "360AC0000000034": "国民年金法等の一部を改正する法律（昭和60年法律第34号）",
            "406AC0000000095": "国民年金法等の一部を改正する法律（平成6年法律第95号）",
            "424AC0000000063": "公的年金制度の財政基盤及び最低保障機能の強化等のための国民年金法等の一部を改正する法律",
            "424AC0000000102": "年金生活者支援給付金の支給に関する法律",
            "330M50002000022": "労働者災害補償保険法施行規則",
            "349M50002000030": "労働者災害補償保険特別支給金支給規則",
            "331AC0000000126": "労働保険審査官及び労働保険審査会法",
            "347M50002000008": "労働保険の保険料の徴収等に関する法律施行規則",
            "215CO0000000243": "健康保険法施行令"
        };
        return KNOWN_LAWS[lawId] || lawId;
    }

    console.log(getMappedLawId("412AC0000000018", "Sp-At_20"));