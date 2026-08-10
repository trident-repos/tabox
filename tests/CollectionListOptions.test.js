/* global browser */
import { render, act, waitFor, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CollectionListOptions } from '../app/CollectionListOptions';
import { Provider } from 'jotai';

describe('Collection List Options tests', () => {
  test('CollectionListOptions renders correctly', async () => {
    let container;
    
    await act(async () => {
      const result = render(
        <Provider>
          <CollectionListOptions />
        </Provider>,
      );
      container = result.container;
      
      // Allow all microtasks (Promise resolutions) to complete
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    
    expect(container).toMatchSnapshot();
  });

  test('uses the full-page toolbar button styles with a working sort dropdown in popup view', async () => {
    let container;
    await act(async () => {
      ({ container } = render(
        <Provider>
          <CollectionListOptions addCollection={jest.fn()} />
        </Provider>,
      ));
    });

    await waitFor(() => {
      expect(container.querySelector('.collections-toolbar.fp-toolbar')).toBeInTheDocument();
      expect(container.querySelector('#toolbar-sort-select .toolbar-select__control')).toBeInTheDocument();
      expect(container.querySelector('#toolbar-sort-select .toolbar-select-single-value')).toBeInTheDocument();
      expect(container.querySelector('#toolbar-sort-direction')).toHaveClass('fp-toolbar-btn');
      expect(container.querySelector('#toolbar-open-new-window')).toHaveClass('fp-toolbar-btn');
      expect(container.querySelector('#toolbar-view-mode')).toHaveClass('fp-toolbar-btn');
      expect(container.querySelector('#toolbar-import')).toHaveClass('fp-toolbar-btn');
      expect(container.querySelector('.fp-toolbar-pill')).toBeInTheDocument();
      expect(container.querySelector('.fp-toolbar-color-picker')).toBeInTheDocument();
    });

    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /opened/i })).toHaveTextContent('Opened');
    expect(screen.getByRole('button', { name: /import collections from file/i })).toBeInTheDocument();

    fireEvent.mouseDown(container.querySelector('#toolbar-sort-select .toolbar-select__control'));

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Color')).toBeInTheDocument();
    });
  });

  test('keeps popup import limited to legacy txt files', async () => {
    let container;
    await act(async () => {
      ({ container } = render(
        <Provider>
          <CollectionListOptions addCollection={jest.fn()} />
        </Provider>,
      ));
    });

    expect(container.querySelector('input[type="file"]')).toHaveAttribute('accept', '.txt');
  });

  test('shows the full-page modal instead of the file picker on Linux (issue #68)', async () => {
    browser.runtime.getPlatformInfo = jest.fn().mockResolvedValue({ os: 'linux' });
    browser.runtime.getURL = jest.fn((path) => `chrome-extension://abc/${path}`);
    browser.tabs.query = jest.fn().mockResolvedValue([]);
    browser.tabs.create = jest.fn().mockResolvedValue({ id: 42 });
    const closeSpy = jest.spyOn(window, 'close').mockImplementation(() => {});

    let container;
    await act(async () => {
      ({ container } = render(
        <Provider>
          <CollectionListOptions addCollection={jest.fn()} />
        </Provider>,
      ));
    });

    const fileInput = container.querySelector('input[type="file"]');
    const clickSpy = jest.spyOn(fileInput, 'click');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /import collections from file/i }));
    });

    // The picker is NOT opened; the explanatory modal is.
    expect(clickSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/only possible from the/i)).toBeInTheDocument();

    // "Open Full Page" hands the import off to the full-page view.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /open full page/i }));
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ pendingImportRequest: expect.any(Number) }),
    );
    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: browser.runtime.getURL('fullpage.html'),
    });
    closeSpy.mockRestore();
  });

  test('shows the full-page modal on Firefox regardless of OS (issue #68)', async () => {
    browser.runtime.getPlatformInfo = jest.fn().mockResolvedValue({ os: 'mac' });
    browser.runtime.getURL = jest.fn((path = '') => `moz-extension://abc/${path}`);

    await act(async () => {
      render(
        <Provider>
          <CollectionListOptions addCollection={jest.fn()} />
        </Provider>,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /import collections from file/i }));
    });

    expect(await screen.findByText(/only possible from the/i)).toBeInTheDocument();
    expect(browser.runtime.getPlatformInfo).not.toHaveBeenCalled(); // moz-extension short-circuits
  });

  test('keeps the in-popup file picker on non-Linux Chromium (issue #68)', async () => {
    browser.runtime.getPlatformInfo = jest.fn().mockResolvedValue({ os: 'mac' });
    browser.runtime.getURL = jest.fn((path = '') => `chrome-extension://abc/${path}`);

    let container;
    await act(async () => {
      ({ container } = render(
        <Provider>
          <CollectionListOptions addCollection={jest.fn()} />
        </Provider>,
      ));
    });

    const fileInput = container.querySelector('input[type="file"]');
    const clickSpy = jest.spyOn(fileInput, 'click');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /import collections from file/i }));
    });

    expect(clickSpy).toHaveBeenCalled();
    expect(screen.queryByText(/only possible from the/i)).not.toBeInTheDocument();
  });

  test('renders the AI button in the toolbar when Tabox AI is enabled', async () => {
    browser.storage.local.get.mockResolvedValue({ chkTaboxAI: true });

    let container;
    await act(async () => {
      ({ container } = render(
        <Provider>
          <CollectionListOptions addCollection={jest.fn()} />
        </Provider>,
      ));
    });

    await waitFor(() => {
      expect(container.querySelector('.collections-toolbar .ai-button')).toBeInTheDocument();
    });
  });
});
