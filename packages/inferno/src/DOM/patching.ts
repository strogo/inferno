/**
 * @module Inferno
 */
/** TypeDoc Comment */

import {
  combineFrom,
  isFunction,
  isInvalid,
  isNull,
  isNullOrUndef,
  isString,
  isUndefined,
  NO_OP,
  throwError
} from 'inferno-shared';
import { ChildFlags, VNodeFlags } from 'inferno-vnode-flags';
import { directClone, options, VNode } from '../core/implementation';
import { mount, mountArrayChildren, mountRef } from './mounting';
import { remove, removeAllChildren, unmount } from './unmounting';
import {
  appendChild,
  EMPTY_OBJ,
  insertOrAppend,
  replaceChild
} from './utils/common';
import {
  isControlledFormElement,
  processElement
} from './wrappers/processElement';
import { isAttrAnEvent, patchEvent, patchProp } from './props';
import { handleComponentInput } from './utils/componentutil';
import { validateKeys } from '../core/validate';
import { handleEvent } from "./events/delegation";
import { delegatedEvents, strictProps } from "./constants";

function replaceWithNewNode(lastNode,
                            nextNode,
                            parentDom,
                            lifecycle: Function[],
                            context: Object,
                            isSVG: boolean) {
  unmount(lastNode);
  replaceChild(
    parentDom,
    mount(nextNode, null, lifecycle, context, isSVG),
    lastNode.dom
  );
}

export function patch(lastVNode: VNode,
                      nextVNode: VNode,
                      parentDom: Element,
                      lifecycle: Function[],
                      context: Object,
                      isSVG: boolean) {
  if (lastVNode !== nextVNode) {
    const nextFlags = nextVNode.flags;

    if (lastVNode.flags !== nextFlags || nextFlags & VNodeFlags.ReCreate) {
      replaceWithNewNode(
        lastVNode,
        nextVNode,
        parentDom,
        lifecycle,
        context,
        isSVG
      );
    } else if (nextFlags & VNodeFlags.Element) {
      patchElement(lastVNode, nextVNode, parentDom, lifecycle, context, isSVG);
    } else if (nextFlags & VNodeFlags.Component) {
      patchComponent(
        lastVNode,
        nextVNode,
        parentDom,
        lifecycle,
        context,
        isSVG,
        (nextFlags & VNodeFlags.ComponentClass) > 0
      );
    } else if (nextFlags & VNodeFlags.Text) {
      patchText(lastVNode, nextVNode, parentDom);
    } else if (nextFlags & VNodeFlags.Void) {
      nextVNode.dom = lastVNode.dom;
    } else {
      // Portal
      patchPortal(lastVNode, nextVNode, lifecycle, context);
    }
  }
}

function patchPortal(lastVNode: VNode, nextVNode: VNode, lifecycle, context) {
  const lastContainer = lastVNode.type as Element;
  const nextContainer = nextVNode.type as Element;
  const nextChildren = nextVNode.children as VNode;

  patchChildren(
    lastVNode.childFlags,
    nextVNode.childFlags,
    lastVNode.children as VNode,
    nextChildren,
    lastContainer as Element,
    lifecycle,
    context,
    false
  );

  nextVNode.dom = lastVNode.dom;

  if (lastContainer !== nextContainer && !isInvalid(nextChildren)) {
    const node = nextChildren.dom as Element;

    lastContainer.removeChild(node);
    nextContainer.appendChild(node);
  }
}

export function patchElement(lastVNode: VNode,
                             nextVNode: VNode,
                             parentDom: Element | null,
                             lifecycle: Function[],
                             context: Object,
                             isSVG: boolean) {
  const nextTag = nextVNode.type;

  if (lastVNode.type !== nextTag) {
    replaceWithNewNode(
      lastVNode,
      nextVNode,
      parentDom,
      lifecycle,
      context,
      isSVG
    );
  } else {
    const dom = lastVNode.dom as Element;
    const nextFlags = nextVNode.flags;

    const lastProps = lastVNode.props;
    const nextProps = nextVNode.props;
    let isFormElement = false;
    let hasControlledValue = false;
    let nextPropsOrEmpty;

    nextVNode.dom = dom;
    isSVG = isSVG || (nextFlags & VNodeFlags.SvgElement) > 0;

    // inlined patchProps  -- starts --
    if (lastProps !== nextProps) {
      const lastPropsOrEmpty = lastProps || EMPTY_OBJ;
      nextPropsOrEmpty = nextProps || (EMPTY_OBJ as any);

      if (nextPropsOrEmpty !== EMPTY_OBJ) {
        isFormElement = (nextFlags & VNodeFlags.FormElement) > 0;
        if (isFormElement) {
          hasControlledValue = isControlledFormElement(nextPropsOrEmpty);
        }

        for (const prop in nextPropsOrEmpty) {
          patchProp(
            prop,
            lastPropsOrEmpty[prop],
            nextPropsOrEmpty[prop],
            dom,
            isSVG,
            hasControlledValue,
            lastVNode
          );
        }
      }
      if (lastPropsOrEmpty !== EMPTY_OBJ) {
        for (const prop in lastPropsOrEmpty) {
          // do not add a hasOwnProperty check here, it affects performance
          if (
            !nextPropsOrEmpty.hasOwnProperty(prop) &&
            !isNullOrUndef(lastPropsOrEmpty[prop])
          ) {
            if (strictProps.has(prop)) {
              // When removing value of select element, it needs to be set to null instead empty string, because empty string is valid value for option which makes that option selected
              // MS IE/Edge don't follow html spec for textArea and input elements and we need to set empty string to value in those cases to avoid "null" and "undefined" texts
              (dom as any)[prop] = nextFlags & VNodeFlags.SelectElement ? null : '';
            } else if (prop === 'style') {
              dom.removeAttribute('style');
            } else if (delegatedEvents.has(prop)) {
              handleEvent(prop, null, dom);
            } else if (isAttrAnEvent(prop)) {
              patchEvent(prop, lastPropsOrEmpty[prop], null, dom);
            } else if (prop === 'dangerouslySetInnerHTML') {
              dom.textContent = '';
            } else {
              dom.removeAttribute(prop);
            }
          }
        }
      }
    }
    const lastChildren = lastVNode.children;
    const nextChildren = nextVNode.children;
    const nextRef = nextVNode.ref;
    const lastClassName = lastVNode.className;
    const nextClassName = nextVNode.className;

    if (lastChildren !== nextChildren) {
      if (process.env.NODE_ENV !== 'production') {
        validateKeys(nextVNode, nextVNode.childFlags & ChildFlags.HasKeyedChildren);
      }
      patchChildren(
        lastVNode.childFlags,
        nextVNode.childFlags,
        lastChildren,
        nextChildren,
        dom,
        lifecycle,
        context,
        isSVG && nextTag !== 'foreignObject'
      );
    }

    if (isFormElement) {
      processElement(
        nextFlags,
        nextVNode,
        dom,
        nextPropsOrEmpty,
        false,
        hasControlledValue
      );
    }
    // inlined patchProps  -- ends --
    if (lastClassName !== nextClassName) {
      if (isNullOrUndef(nextClassName)) {
        dom.removeAttribute('class');
      } else if (isSVG) {
        dom.setAttribute('class', nextClassName);
      } else {
        dom.className = nextClassName;
      }
    }
    if (isFunction(nextRef) && lastVNode.ref !== nextRef) {
      mountRef(dom as Element, nextRef, lifecycle);
    } else {
      if (process.env.NODE_ENV !== 'production') {
        if (isString(nextRef)) {
          throwError(
            'string "refs" are not supported in Inferno 1.0. Use callback "refs" instead.'
          );
        }
      }
    }
  }
}

function patchChildren(lastChildFlags: ChildFlags,
                       nextChildFlags: ChildFlags,
                       lastChildren,
                       nextChildren,
                       parentDOM: Element,
                       lifecycle: Function[],
                       context: Object,
                       isSVG: boolean) {
  if (lastChildFlags & ChildFlags.HasVNodeChildren) {
    if (nextChildFlags & ChildFlags.HasVNodeChildren) {
      patch(lastChildren, nextChildren, parentDOM, lifecycle, context, isSVG);
    } else if (nextChildFlags & ChildFlags.HasInvalidChildren) {
      remove(lastChildren, parentDOM);
    } else {
      remove(lastChildren, parentDOM);
      mountArrayChildren(nextChildren, parentDOM, lifecycle, context, isSVG);
    }
  } else if (lastChildFlags & ChildFlags.HasInvalidChildren) {
    if (nextChildFlags & ChildFlags.HasInvalidChildren) {
      return;
    }
    if (nextChildFlags & ChildFlags.HasVNodeChildren) {
      mount(nextChildren, parentDOM, lifecycle, context, isSVG);
    } else {
      mountArrayChildren(nextChildren, parentDOM, lifecycle, context, isSVG);
    }
  } else {
    if (nextChildFlags & ChildFlags.MultipleChildren) {
      const lastLength = lastChildren.length;
      const nextLength = nextChildren.length;

      // Fast path's for both algorithms
      if (lastLength === 0) {
        if (nextLength > 0) {
          mountArrayChildren(
            nextChildren,
            parentDOM,
            lifecycle,
            context,
            isSVG
          );
        }
      } else if (nextLength === 0) {
        removeAllChildren(parentDOM, lastChildren);
      } else {
        if (
          nextChildFlags & ChildFlags.HasKeyedChildren &&
          lastChildFlags & ChildFlags.HasKeyedChildren
        ) {
          patchKeyedChildren(
            lastChildren,
            nextChildren,
            parentDOM,
            lifecycle,
            context,
            isSVG,
            lastLength,
            nextLength
          );
        } else {
          patchNonKeyedChildren(
            lastChildren,
            nextChildren,
            parentDOM,
            lifecycle,
            context,
            isSVG,
            lastLength,
            nextLength
          );
        }
      }
    } else if (nextChildFlags & ChildFlags.HasInvalidChildren) {
      removeAllChildren(parentDOM, lastChildren);
    } else {
      removeAllChildren(parentDOM, lastChildren);
      mount(nextChildren, parentDOM, lifecycle, context, isSVG);
    }
  }
}

export function updateClassComponent(instance,
                                     nextState,
                                     nextVNode: VNode,
                                     nextProps,
                                     parentDom,
                                     lifecycle: Function[],
                                     context,
                                     isSVG: boolean,
                                     force: boolean,
                                     fromSetState: boolean) {
  const lastState = instance.state;
  const lastProps = instance.props;
  nextVNode.children = instance;
  const lastInput = instance.$LI;
  let renderOutput;

  if (instance.$UN) {
    if (process.env.NODE_ENV !== 'production') {
      throwError(
        'Inferno Error: Can only update a mounted or mounting component. This usually means you called setState() or forceUpdate() on an unmounted component. This is a no-op.'
      );
    }
    return;
  }
  if (lastProps !== nextProps || nextProps === EMPTY_OBJ) {
    if (!fromSetState && isFunction(instance.componentWillReceiveProps)) {
      instance.$BR = true;
      instance.componentWillReceiveProps(nextProps, context);
      // If instance component was removed during its own update do nothing...
      if (instance.$UN) {
        return;
      }
      instance.$BR = false;
    }
    if (instance.$PSS) {
      nextState = combineFrom(nextState, instance.$PS) as any;
      instance.$PSS = false;
      instance.$PS = null;
    }
  }

  /* Update if scu is not defined, or it returns truthy value or force */
  const hasSCU = isFunction(instance.shouldComponentUpdate);

  if (
    force ||
    !hasSCU ||
    (hasSCU &&
      (instance.shouldComponentUpdate as Function)(
        nextProps,
        nextState,
        context
      ))
  ) {
    if (isFunction(instance.componentWillUpdate)) {
      instance.$BS = true;
      instance.componentWillUpdate(nextProps, nextState, context);
      instance.$BS = false;
    }

    instance.props = nextProps;
    instance.state = nextState;
    instance.context = context;

    if (isFunction(options.beforeRender)) {
      options.beforeRender(instance);
    }
    renderOutput = instance.render(nextProps, nextState, context);

    if (isFunction(options.afterRender)) {
      options.afterRender(instance);
    }

    const didUpdate = renderOutput !== NO_OP;

    let childContext;
    if (isFunction(instance.getChildContext)) {
      childContext = instance.getChildContext();
    }
    if (isNullOrUndef(childContext)) {
      childContext = context;
    } else {
      childContext = combineFrom(context, childContext);
    }
    instance.$CX = childContext;

    if (didUpdate) {
      const nextInput = (instance.$LI = handleComponentInput(
        renderOutput,
        nextVNode
      ));
      patch(lastInput, nextInput, parentDom, lifecycle, childContext, isSVG);
      if (isFunction(instance.componentDidUpdate)) {
        instance.componentDidUpdate(lastProps, lastState);
      }
      if (isFunction(options.afterUpdate)) {
        options.afterUpdate(nextVNode);
      }
    }
  } else {
    instance.props = nextProps;
    instance.state = nextState;
    instance.context = context;
  }
  nextVNode.dom = instance.$LI.dom;
}

function patchComponent(lastVNode,
                        nextVNode,
                        parentDom,
                        lifecycle: Function[],
                        context,
                        isSVG: boolean,
                        isClass: boolean): void {
  const nextType = nextVNode.type;
  const lastKey = lastVNode.key;
  const nextKey = nextVNode.key;

  if (lastVNode.type !== nextType || lastKey !== nextKey) {
    replaceWithNewNode(
      lastVNode,
      nextVNode,
      parentDom,
      lifecycle,
      context,
      isSVG
    );
  } else {
    const nextProps = nextVNode.props || EMPTY_OBJ;

    if (isClass) {
      const instance = lastVNode.children;
      instance.$UPD = true;

      updateClassComponent(
        instance,
        instance.state,
        nextVNode,
        nextProps,
        parentDom,
        lifecycle,
        context,
        isSVG,
        false,
        false
      );
      instance.$V = nextVNode;
      instance.$UPD = false;
    } else {
      let shouldUpdate = true;
      const lastProps = lastVNode.props;
      const nextHooks = nextVNode.ref;
      const nextHooksDefined = !isNullOrUndef(nextHooks);
      const lastInput = lastVNode.children;

      nextVNode.dom = lastVNode.dom;
      nextVNode.children = lastInput;

      if (nextHooksDefined && isFunction(nextHooks.onComponentShouldUpdate)) {
        shouldUpdate = nextHooks.onComponentShouldUpdate(lastProps, nextProps);
      }

      if (shouldUpdate !== false) {
        if (nextHooksDefined && isFunction(nextHooks.onComponentWillUpdate)) {
          nextHooks.onComponentWillUpdate(lastProps, nextProps);
        }
        let nextInput = nextType(nextProps, context);

        if (nextInput !== NO_OP) {
          nextInput = handleComponentInput(nextInput, nextVNode);
          patch(lastInput, nextInput, parentDom, lifecycle, context, isSVG);
          nextVNode.children = nextInput;
          nextVNode.dom = nextInput.dom;
          if (nextHooksDefined && isFunction(nextHooks.onComponentDidUpdate)) {
            nextHooks.onComponentDidUpdate(lastProps, nextProps);
          }
        }
      } else if (lastInput.flags & VNodeFlags.Component) {
        lastInput.parentVNode = nextVNode;
      }
    }
  }
}

function patchText(lastVNode: VNode, nextVNode: VNode, parentDom: Element) {
  const nextText = nextVNode.children as string;
  const textNode = parentDom.firstChild;
  let dom;
  // Guard against external change on DOM node.
  if (isNull(textNode)) {
    parentDom.textContent = nextText;
    dom = parentDom.firstChild as Element;
  } else {
    dom = lastVNode.dom;
    if (nextText !== lastVNode.children) {
      (dom as Element).nodeValue = nextText;
    }
  }
  nextVNode.dom = dom;
}

function patchNonKeyedChildren(lastChildren,
                               nextChildren,
                               dom,
                               lifecycle: Function[],
                               context: Object,
                               isSVG: boolean,
                               lastChildrenLength: number,
                               nextChildrenLength: number) {
  const commonLength =
    lastChildrenLength > nextChildrenLength
      ? nextChildrenLength
      : lastChildrenLength;
  let i = 0;

  for (; i < commonLength; i++) {
    let nextChild = nextChildren[i];

    if (nextChild.dom) {
      nextChild = nextChildren[i] = directClone(nextChild);
    }
    patch(lastChildren[i], nextChild, dom, lifecycle, context, isSVG);
  }
  if (lastChildrenLength < nextChildrenLength) {
    for (i = commonLength; i < nextChildrenLength; i++) {
      let nextChild = nextChildren[i];

      if (nextChild.dom) {
        nextChild = nextChildren[i] = directClone(nextChild);
      }
      appendChild(dom, mount(nextChild, null, lifecycle, context, isSVG));
    }
  } else if (lastChildrenLength > nextChildrenLength) {
    for (i = commonLength; i < lastChildrenLength; i++) {
      remove(lastChildren[i], dom);
    }
  }
}

function patchKeyedChildren(a: VNode[],
                            b: VNode[],
                            dom,
                            lifecycle: Function[],
                            context,
                            isSVG: boolean,
                            aLength: number,
                            bLength: number) {
  let aEnd = aLength - 1;
  let bEnd = bLength - 1;
  let aStart = 0;
  let bStart = 0;
  let i;
  let j;
  let aNode;
  let bNode;
  let nextNode;
  let nextPos;
  let node;
  let aStartNode = a[aStart];
  let bStartNode = b[bStart];
  let aEndNode = a[aEnd];
  let bEndNode = b[bEnd];

  if (bStartNode.dom) {
    b[bStart] = bStartNode = directClone(bStartNode);
  }
  if (bEndNode.dom) {
    b[bEnd] = bEndNode = directClone(bEndNode);
  }
  // Step 1
  // tslint:disable-next-line
  outer: {
    // Sync nodes with the same key at the beginning.
    while (aStartNode.key === bStartNode.key) {
      patch(aStartNode, bStartNode, dom, lifecycle, context, isSVG);
      aStart++;
      bStart++;
      if (aStart > aEnd || bStart > bEnd) {
        break outer;
      }
      aStartNode = a[aStart];
      bStartNode = b[bStart];
      if (bStartNode.dom) {
        b[bStart] = bStartNode = directClone(bStartNode);
      }
    }

    // Sync nodes with the same key at the end.
    while (aEndNode.key === bEndNode.key) {
      patch(aEndNode, bEndNode, dom, lifecycle, context, isSVG);
      aEnd--;
      bEnd--;
      if (aStart > aEnd || bStart > bEnd) {
        break outer;
      }
      aEndNode = a[aEnd];
      bEndNode = b[bEnd];
      if (bEndNode.dom) {
        b[bEnd] = bEndNode = directClone(bEndNode);
      }
    }
  }

  if (aStart > aEnd) {
    if (bStart <= bEnd) {
      nextPos = bEnd + 1;
      nextNode = nextPos < bLength ? b[nextPos].dom : null;
      while (bStart <= bEnd) {
        node = b[bStart];
        if (node.dom) {
          b[bStart] = node = directClone(node);
        }
        bStart++;
        insertOrAppend(
          dom,
          mount(node, null, lifecycle, context, isSVG),
          nextNode
        );
      }
    }
  } else if (bStart > bEnd) {
    while (aStart <= aEnd) {
      remove(a[aStart++], dom);
    }
  } else {
    const aLeft = aEnd - aStart + 1;
    const bLeft = bEnd - bStart + 1;
    const sources = new Array(bLeft).fill(-1);
    let moved = false;
    let pos = 0;
    let patched = 0;

    // When sizes are small, just loop them through
    if (bLeft <= 4 || aLeft * bLeft <= 16) {
      for (i = aStart; i <= aEnd; i++) {
        aNode = a[i];
        if (patched < bLeft) {
          for (j = bStart; j <= bEnd; j++) {
            bNode = b[j];
            if (aNode.key === bNode.key) {
              sources[j - bStart] = i;

              if (pos > j) {
                moved = true;
              } else {
                pos = j;
              }
              if (bNode.dom) {
                b[j] = bNode = directClone(bNode);
              }
              patch(aNode, bNode, dom, lifecycle, context, isSVG);
              patched++;
              a[i] = null as any;
              break;
            }
          }
        }
      }
    } else {
      const keyIndex = new Map();

      // Map keys by their index in array
      for (i = bStart; i <= bEnd; i++) {
        keyIndex.set(b[i].key, i);
      }

      // Try to patch same keys
      for (i = aStart; i <= aEnd; i++) {
        aNode = a[i];

        if (patched < bLeft) {
          j = keyIndex.get(aNode.key);

          if (!isUndefined(j)) {
            bNode = b[j];
            sources[j - bStart] = i;
            if (pos > j) {
              moved = true;
            } else {
              pos = j;
            }
            if (bNode.dom) {
              b[j] = bNode = directClone(bNode);
            }
            patch(aNode, bNode, dom, lifecycle, context, isSVG);
            patched++;
            a[i] = null as any;
          }
        }
      }
    }
    // fast-path: if nothing patched remove all old and add all new
    if (aLeft === aLength && patched === 0) {
      removeAllChildren(dom, a);
      mountArrayChildren(b,
        dom,
        lifecycle,
        context,
        isSVG
      );
    } else {
      i = aLeft - patched;
      while (i > 0) {
        aNode = a[aStart++];
        if (!isNull(aNode)) {
          remove(aNode, dom);
          i--;
        }
      }
      if (moved) {
        const seq = lis_algorithm(sources);
        j = seq.length - 1;
        for (i = bLeft - 1; i >= 0; i--) {
          if (sources[i] === -1) {
            pos = i + bStart;
            node = b[pos];
            if (node.dom) {
              b[pos] = node = directClone(node);
            }
            nextPos = pos + 1;
            insertOrAppend(
              dom,
              mount(node, null, lifecycle, context, isSVG),
              nextPos < bLength ? b[nextPos].dom : null
            );
          } else if (j < 0 || i !== seq[j]) {
            pos = i + bStart;
            node = b[pos];
            nextPos = pos + 1;
            insertOrAppend(
              dom,
              node.dom,
              nextPos < bLength ? b[nextPos].dom : null
            );
          } else {
            j--;
          }
        }
      } else if (patched !== bLeft) {
        // when patched count doesn't match b length we need to insert those new ones
        // loop backwards so we can use insertBefore
        for (i = bLeft - 1; i >= 0; i--) {
          if (sources[i] === -1) {
            pos = i + bStart;
            node = b[pos];
            if (node.dom) {
              b[pos] = node = directClone(node);
            }
            nextPos = pos + 1;
            insertOrAppend(
              dom,
              mount(node, null, lifecycle, context, isSVG),
              nextPos < bLength ? b[nextPos].dom : null
            );
          }
        }
      }
    }
  }
}

// // https://en.wikipedia.org/wiki/Longest_increasing_subsequence
function lis_algorithm(arr: number[]): number[] {
  const p = arr.slice();
  const result: number[] = [0];
  let i;
  let j;
  let u;
  let v;
  let c;
  const len = arr.length;

  for (i = 0; i < len; i++) {
    const arrI = arr[i];

    if (arrI !== -1) {
      j = result[result.length - 1];
      if (arr[j] < arrI) {
        p[i] = j;
        result.push(i);
        continue;
      }

      u = 0;
      v = result.length - 1;

      while (u < v) {
        c = ((u + v) / 2) | 0;
        if (arr[result[c]] < arrI) {
          u = c + 1;
        } else {
          v = c;
        }
      }

      if (arrI < arr[result[u]]) {
        if (u > 0) {
          p[i] = result[u - 1];
        }
        result[u] = i;
      }
    }
  }

  u = result.length;
  v = result[u - 1];

  while (u-- > 0) {
    result[u] = v;
    v = p[v];
  }

  return result;
}
