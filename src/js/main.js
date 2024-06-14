import '../scss/styles.scss';



var utils = (() => {
    function dom(selector) {
        if (selector[0] === '#') {
            return document.getElementById(selector.slice(1));
        }
        return document.querySelectorAll(selector);
    }

    function copyJSON(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function isTouchDevice() {
        return /iPhone|iPod|iPad|Android|BlackBerry/.test(navigator.userAgent);
    }

    function getWorkerURLFromElement(selector) {
        var element = dom(selector);
        var content = element[0].textContent;
        var blob = new Blob([content], { type: 'text/javascript' });
        return URL.createObjectURL(blob);
    }

    var cursorManager = (function () {
        var cursorManager = {};

        var voidNodeTags = [
            'AREA', 'BASE', 'BR', 'COL', 'EMBED',
            'HR', 'IMG', 'INPUT', 'KEYGEN', 'LINK',
            'MENUITEM', 'META', 'PARAM', 'SOURCE',
            'TRACK', 'WBR', 'BASEFONT', 'BGSOUND',
            'FRAME', 'ISINDEX'
        ];

        if (!Array.prototype.includes) {
            Array.prototype.includes = function (obj) {
                return this.indexOf(obj) !== -1;
            };
        }

        function canContainText(node) {
            return node.nodeType === 1 && !voidNodeTags.includes(node.nodeName);
        }

        function getLastChildElement(el) {
            var lc = el.lastChild;
            while (lc && lc.nodeType !== 1) {
                lc = lc.previousSibling || lc.previousElementSibling;
            }
            return lc;
        }

        cursorManager.setEndOfContenteditable = function (contentEditableElement) {
            while (getLastChildElement(contentEditableElement) &&
                canContainText(getLastChildElement(contentEditableElement))) {
                contentEditableElement = getLastChildElement(contentEditableElement);
            }

            var range, selection;
            if (document.createRange) {
                range = document.createRange();
                range.selectNodeContents(contentEditableElement);
                range.collapse(false);
                selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            } else if (document.getSelection()) {
                selection = document.getSelection();
                range = document.createRange();
                range.selectNodeContents(contentEditableElement);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);

            }
        };

        return cursorManager;
    })();

    return {
        copyJSON, cursorManager, dom,
        getWorkerURLFromElement, isTouchDevice
    };
})();

class SudokuAdapter {
    constructor(url) {
        this.worker = new Worker(url);
    }

    _postMessage(options) {
        this.worker.postMessage(JSON.stringify(options));
        return new Promise((resolve, reject) => {
            this.worker.onmessage = event => {
                resolve(event.data);
            };
            this.worker.onerror = error => {
                reject(error);
            };
        });
    }

    generate(options) {
        options = Object.assign({}, options, { method: 'generate' });
        return this._postMessage(options);
    }

    validate(options) {
        options = Object.assign({}, options, { method: 'validate' });
        return this._postMessage(options);
    }
}

const SUDOKU_APP_CONFIG = {
    HINTS: 34,
    TRY_LIMIT: 100000,
    WORKER_URL: utils.getWorkerURLFromElement('#worker'),
    DOM_TARGET: utils.dom('#sudoku-app')[0]
};

var SudokuApp = (config => {
    const {
        HINTS, TRY_LIMIT,
        WORKER_URL, DOM_TARGET
    } = config;

    var sudokuAdapter = new SudokuAdapter(WORKER_URL);

    var state = {
        success: null,
        board: null,
        solution: null,
        solved: null,
        errors: []
    };

    var history = [state];
    var historyStash = [];

    function setState(newState, callback) {
        requestAnimationFrame(() => {
            Object.assign(state, newState);
            if (typeof callback === 'function') {
                var param = utils.copyJSON(state);
                requestAnimationFrame(callback.bind(null, param));
            }
        });
    }

    function initialize() {
        unbindEvents();
        render();
        getSudoku().then(sudoku => {
            setState({
                success: sudoku.success,
                board: sudoku.board,
                solution: sudoku.solution,
                errors: [],
                solved: false
            }, newState => {
                history = [newState];
                historyStash = [];
            });
        });
    }

    function bindEvents() {
        var generateButton = utils.dom('#generate-button')[0];
        var solveButton = utils.dom('#solve-button')[0];
        var undoButton = utils.dom('#undo-button')[0];
        var redoButton = utils.dom('#redo-button')[0];

        if (generateButton) generateButton.addEventListener('click', initialize);
        if (solveButton) solveButton.addEventListener('click', onClickSolve);
        if (undoButton) undoButton.addEventListener('click', undo);
        if (redoButton) redoButton.addEventListener('click', redo);

        var cells = Array.from(document.querySelectorAll('.sudoku__table-cell'));
        cells.forEach(cell => {
            cell.addEventListener('keyup', onKeyUpCell);
        });

        window.addEventListener('keydown', keyDown);
    }

    function unbindEvents() {
        var generateButton = utils.dom('#generate-button')[0];
        var solveButton = utils.dom('#solve-button')[0];
        var undoButton = utils.dom('#undo-button')[0];
        var redoButton = utils.dom('#redo-button')[0];

        if (generateButton) generateButton.removeEventListener('click', initialize);
        if (solveButton) solveButton.removeEventListener('click', onClickSolve);
        if (undoButton) undoButton.removeEventListener('click', undo);
        if (redoButton) redoButton.removeEventListener('click', redo);

        var cells = Array.from(document.querySelectorAll('.sudoku__table-cell'));
        cells.forEach(cell => {
            cell.removeEventListener('keyup', onKeyUpCell);
        });
        window.removeEventListener('keydown', keyDown);
    }

    function onClickSolve() {
        setState({
            board: state.solution,
            solved: true,
            errors: []
        });
    }

    function onKeyUpCell(event) {
        var key = event.keyCode;
        if ([36, 37, 38, 39, 9, 17, 16, 91, 19].includes(key)) return;

        var cell = event.target;
        var value = cell.innerText;

        if (value.length > 1) {
            cell.innerText = value.slice(0, 1);
            return false;
        }

        var cellIndex = parseInt(cell.getAttribute('data-cell-index'), 10);
        var rowIndex = Math.floor(cellIndex / 9);
        var cellIndexInRow = cellIndex - (rowIndex * 9);

        var board = state.board.map(row => row.slice());
        board[rowIndex][cellIndexInRow] = value;

        validate(board).then(errors => {
            historyStash = [];
            history.push();
            var solved = null;
            if (errors.indexOf(true) === -1) {
                solved = true;
                board.forEach(row => {
                    row.forEach(value => {
                        if (!value || !parseInt(value, 10) || value.length > 1) {
                            solved = false;
                        }
                    });
                });
            }
            if (solved) {
                board = board.map(row => row.map(n => +n));
            }
            setState({ board, errors, solved }, (newState) => {
                history[history.length - 1] = newState;
                restoreCaretPosition(cellIndex);
            });
        });
    }

    function keyDown(event) {
        var keys = {
            ctrlOrCmd: event.ctrlKey || event.metaKey,
            shift: event.shiftKey,
            z: event.keyCode === 90
        };

        if (keys.ctrlOrCmd && keys.z) {
            if (keys.shift && historyStash.length) {
                redo();
            } else if (!keys.shift && history.length > 1) {
                undo();
            }
        }
    }

    function undo() {
        historyStash.push(history.pop());
        setState(utils.copyJSON(history[history.length - 1]));
    }

    function redo() {
        history.push(historyStash.pop());
        setState(utils.copyJSON(history[history.length - 1]));
    }

    function restoreCaretPosition(cellIndex) {
        utils.cursorManager.setEndOfContenteditable(
            utils.dom(`[data-cell-index="${cellIndex}"]`)[0]
        );
    }

    function getSudoku() {
        return sudokuAdapter.generate({
            hints: HINTS,
            limit: TRY_LIMIT
        });
    }

    function validate(board) {
        var map = board.reduce((memo, row) => {
            for (let num of row) {
                memo.push(num);
            }
            return memo;
        }, []).map(num => parseInt(num, 10));

        var validations = [];

        for (let [index, number] of map.entries()) {
            if (!number) {
                validations.push(
                    Promise.resolve({ result: { box: -1, col: -1, row: -1 } })
                );
            } else {
                let all = Promise.all(validations);
                validations.push(all.then(() => {
                    return sudokuAdapter.validate({ map, number, index });
                }));
            }
        }

        return Promise.all(validations)
            .then(values => {
                var errors = [];
                for (let [index, validation] of values.entries()) {
                    let { box, col, row } = validation.result;
                    let errorInBox = box.first !== box.last;
                    let errorInCol = col.first !== col.last;
                    let errorInRow = row.first !== row.last;

                    let indexOfRow = Math.floor(index / 9);
                    let indexInRow = index - (indexOfRow * 9);

                    errors[index] = errorInRow || errorInCol || errorInBox;
                }

                return errors;
            });
    }

    function render() {
        unbindEvents();

        DOM_TARGET.innerHTML = `
            <div class='sudoku'>
                ${headerComponent()}
                ${contentComponent()}
            </div>
        `;

        bindEvents();
    }

    function headerComponent() {
        return `
            <div class='sudoku__header'>
                <h1 class='sudoku__title'>
                    <span class='show-on-sm'>Sudoku</span>
                    <span class='show-on-md'>Sudoku Puzzle</span>
                    <span class='show-on-lg'>Javascript Sudoku Puzzle Generator</span>
                </h1>
                ${descriptionComponent({ infoLevel: 'mini', className: 'sudoku__description show-on-md' })}
                ${descriptionComponent({ infoLevel: 'full', className: 'sudoku__description show-on-lg' })}
                ${state.success ? `
                    ${buttonComponent({ id: 'generate-button', text: ['New Board', 'New Board', 'New'], mods: 'primary' })}
                    ${state.solved ? buttonComponent({ id: 'solve-button', text: 'Solved', mods: ['tertiary', 'muted'] }) : buttonComponent({ id: 'solve-button', text: 'Solve', mods: 'secondary' })}
                ` : `
                    ${buttonComponent({ id: 'generate-button', text: ['Generating', '', ''], mods: ['disabled', 'loading'] })}
                    ${buttonComponent({ id: 'solve-button', text: 'Solve', mods: 'disabled' })}
                `}
                ${utils.isTouchDevice() ? `
                    ${buttonComponent({ id: 'redo-button', text: ['&raquo;', '&raquo;', '&gt;', '&gt;'], classes: 'fr', mods: ['neutral', 'compound', 'compound-last', !historyStash.length ? 'disabled' : ''] })}
                    ${buttonComponent({ id: 'undo-button', text: ['&laquo;', '&laquo;', '&lt;', '&lt;'], classes: 'fr', mods: ['neutral', 'compound', 'compound-first', history.length > 1 ? '' : 'disabled'] })}
                ` : ''}
            </div>
        `;
    }

    function contentComponent() {
        var rows = state.board;
        var resultReady = !!state.board;
        var fail = resultReady && !state.success;
    
        if (!resultReady) {
            return `
                ${messageComponent({ state: 'busy', content: 'Generating new board...' })}
                ${restoreScrollPosComponent()}
            `;
        }
    
        if (fail) {
            return `
                ${messageComponent({ state: 'fail', content: 'Something went wrong with this board, try generating another one.' })}
                ${restoreScrollPosComponent()}
            `;
        }
    
        var bem = {
            makeClassName: function(options) {
                var { block, element, modifiers } = options;
                var className = block;
                if (element) {
                    className += '__' + element;
                }
                if (modifiers) {
                    Object.keys(modifiers).forEach(function(modifier) {
                        if (modifiers[modifier]) {
                            className += ' ' + block + '--' + modifier;
                        }
                    });
                }
                return className;
            }
        };
    
        return `
            <table class='sudoku__table'>
                ${rows.map((row, index) => {
                    let className = bem.makeClassName({
                        block: 'sudoku',
                        element: 'table-row',
                        modifiers: { separator: index && !((index + 1) % 3) }
                    });
    
                    return `
                        <tr class='${className}'>
                            ${row.map((num, _index) => {
                                let cellIndex = (index * 9) + _index;
                                let separator = _index && !((_index + 1) % 3);
                                let editable = typeof num !== 'number';
                                let error = state.errors[cellIndex];
                                let className = bem.makeClassName({
                                    block: 'sudoku',
                                    element: 'table-cell',
                                    modifiers: { separator, editable, error, 'editable-error': editable && error }
                                });
    
                                return `
                                    <td class='${className}' data-cell-index='${cellIndex}' ${editable ? 'contenteditable' : ''}>
                                        ${num}
                                    </td>
                                `;
                            }).join('')}
                        </tr>
                    `;
                }).join('')}
            </table>
        `;
    }

    function buttonComponent(props) {
        var { id, text, mods, classes } = props;

        var blockName = 'button';
        var modifiers = {};
        var modType = toString.call(mods);
        if (modType === '[object String]') {
            modifiers[mods] = true;
        } else if (modType === '[object Array]') {
            mods.forEach(modName => {
                modifiers[modName] = true;
            });
        }

        
        var blockClasses = bem.makeClassName({ block: blockName, modifiers: modifiers });
        var buttonTextClass = `${blockName}-text`;

        if (Object.keys(modifiers).length) {
            buttonTextClass += Object.keys(modifiers).reduce((memo, curr) => {
                return memo + ` ${blockName}--${curr}-text`;
            }, '');
        }

        var lgText = typeof text === 'string' ? text : text[0];
        var mdText = typeof text === 'string' ? text : text[1];
        var smText = typeof text === 'string' ? text : text[2];

        return `
            <button id='${id}' class='${blockClasses} ${classes || ''}'>
                <span class='show-on-sm ${buttonTextClass}'>${smText}</span>
                <span class='show-on-md ${buttonTextClass}'>${mdText}</span>
                <span class='show-on-lg ${buttonTextClass}'>${lgText}</span>
            </button>
        `;
    }

    function messageComponent(options) {
        var { state, content } = options;

        var messageClass = bem.makeClassName({ block: 'message', modifiers: state ? { [state]: true } : {} });

        return `<p class='${messageClass}'>${content}</p>`;
    }

    function descriptionComponent(options) {
        var { className, infoLevel } = options;

        var technical = `In this demo, <a href='https://en.wikipedia.org/wiki/Backtracking'>backtracking algorithm</a> is used for <em>generating</em> the sudoku.`;

        var description = `Difficulty and solvability is totally random as I randomly left a certain number of hints from a full-filled board.`;

        if (infoLevel === 'full') {
            return `<p class='${className || ''}'>${technical} ${description}</p>`;
        } else if (infoLevel === 'mini') {
            return `<p class='${className || ''}'>${description}</p>`;
        }
    }

    function restoreScrollPosComponent() {
        return `<div style='height: 540px'></div>`;
    }

    return { initialize };

})(SUDOKU_APP_CONFIG).initialize();