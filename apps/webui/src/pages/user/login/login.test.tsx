// @ts-ignore
import { startMock } from '@@/requestRecordMock';
import { TestBrowser } from '@@/testBrowser';
import { fireEvent, render } from '@testing-library/react';
import React, { act } from 'react';

let server: {
  close: () => void;
};

describe('Login Page', () => {
  beforeAll(async () => {
    server = await startMock({
      port: 8000,
      scene: 'login',
    });
  });

  afterAll(() => {
    server?.close();
  });

  it('should show login form', async () => {
    const historyRef = React.createRef<any>();
    const rootContainer = render(
      <TestBrowser
        historyRef={historyRef}
        location={{
          pathname: '/user/login',
        }}
      />,
    );

    await rootContainer.findAllByText('BloomsClaw');

    act(() => {
      historyRef.current?.push('/user/login');
    });

    expect(
      rootContainer.baseElement?.querySelector('.ant-pro-form-login-desc')
        ?.textContent,
    ).toBe(
      'BloomsClaw agent configuration and collaboration platform',
    );

    expect(rootContainer.asFragment()).toMatchSnapshot();

    rootContainer.unmount();
  });

  it('should login success', async () => {
    const historyRef = React.createRef<any>();
    const rootContainer = render(
      <TestBrowser
        historyRef={historyRef}
        location={{
          pathname: '/user/login',
        }}
      />,
    );

    await rootContainer.findAllByText('BloomsClaw');

    const userNameInput = await rootContainer.findByPlaceholderText(
      'Username: admin or user',
    );

    act(() => {
      fireEvent.change(userNameInput, { target: { value: 'admin' } });
    });

    const passwordInput = await rootContainer.findByPlaceholderText(
      'Password: ant.design',
    );

    act(() => {
      fireEvent.change(passwordInput, { target: { value: 'ant.design' } });
    });

    (await rootContainer.findByText('Login')).click();

    // Wait for login to succeed and navigate to home page
    await rootContainer.findByText('BloomsClaw', undefined, {
      timeout: 10000,
    });

    expect(rootContainer.asFragment()).toMatchSnapshot();

    rootContainer.unmount();
  });
});
